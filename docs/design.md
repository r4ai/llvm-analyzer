# 設計: LLVM IR Language Server VSCode拡張機能

LLVM IR (`.ll`) 向けにシンタックスハイライト・定義ジャンプ・参照検索・ホバー・アウトライン・診断・補完・リネームを提供するVSCode拡張機能の全体設計。
最新安定 (LLVM 18+, opaque pointer `ptr`) を対象とし、古い typed pointer (`i8*`) 記法もパースは通すが警告しない。

## アーキテクチャ方針

pnpm workspace のモノレポ。**純粋ドメイン層（vscode/LSP非依存）とアダプタ層を分離**し、解析ロジックを環境非依存で徹底的にユニットテストできるようにする（AGENTS.md の古典派TDD・関心の分離・副作用の隔離に準拠）。

```
packages/
├── parser/          # [純粋] source → tokens → AST。副作用なし。最重要TDD対象
├── analyzer/        # [純粋] AST → 意味モデル（シンボル表/定義参照/型解決/診断）
├── language-server/ # [アダプタ] vscode-languageserver で analyzer をLSPに接続
└── vscode-extension/# [配布物] vscode-languageclient + TextMate文法 + contributes
```

依存方向: `vscode-extension → language-server → analyzer → parser`。
parser/analyzer は `vscode*` に一切依存しない。

## 各パッケージの責務

### parser（純粋・最重要）

- **lexer**: 状態遷移表ベースのトークナイザ。各トークンに `range`（offset/line/column, **0始まり**＝LSP互換）を保持。
  - 公開API: `tokenize(source: string): Token[]`（純粋関数、末尾に必ずゼロ幅の `Eof`）。
  - 不変条件: `source.slice(range.start.offset, range.end.offset) === token.value`。
  - 不正な文字は `Unknown` トークンとして残し解析を止めない（エラー回復）。
  - トークン種別: グローバル識別子 `@name`/`@"..."`/`@1`、ローカル識別子 `%name`/`%1`、ラベル (`name:`)、
    メタデータ `!name`/`!0`、属性グループ `#0`、comdat `$name`、
    型キーワード (`i32`, `ptr`, `void`, `float`…)、命令オペコード、定数 (`true`/`null`…)、数値、文字列、コメント (`;`)、記号。
    バーワード（記号なしの語）は lexer 内で既知の語集合により種別まで分類する（未分類は `Identifier`）。
- **ast**: ノード型定義（Module / TypeDefinition / GlobalVariable / FunctionDefinition / FunctionDeclaration / BasicBlock / Instruction / IdentifierRef / MetadataDefinition…）。各ノードに `range`。
- **parser**: 再帰下降パーサ。**エラー回復付き**（1行の失敗で全体を止めず `UnknownEntry`＋診断で継続）で構文エラーを診断として収集。
  - **粒度は「構造重視・命令は粗く」**: トップレベル構造は型付きノードへ分解するが、命令・型の内部は構造化せず、出現する識別子参照（`@`/`%`/`!`/`#`/`$`・ラベル）を {@link IdentifierRef} として収集するにとどめる。定義/参照位置が取れれば LSP の definition/references/documentSymbol/foldingRange が成立する。型の構造化・各オペコード専用ノードは将来フェーズ。
  - **走査方針**: LLVM IR は実体として 1 行 1 文なのでトップレベルは**行ベース**で走査し、`define` 本体のみ `{`...`}` のブレース対応でブロックを切り出す。
  - 各トップレベルエントリは共通で `defines?`（導入する名前）と `references`（本体の参照列）を持ち、analyzer のシンボル表/定義参照インデックスの直接の入力になる。
- 公開API例: `parseModule(source: string): { ast: Module; diagnostics: ParseDiagnostic[] }`

### analyzer（純粋）

- AST から **シンボル表 + スコープ** を構築する。
  - モジュールスコープ: `@global`、名前付き型 `%struct.Foo`、名前付きメタデータ、属性グループ。
  - 関数スコープ: ローカルSSA値 `%x`（パラメータ含む）、ラベル。
- **定義/参照インデックス**: 各シンボルの定義位置と全参照位置（Go to Definition / Find References / Rename の土台）。
- **型解決**: SSA値の型（Hover表示用）。
- **診断**: 未定義値の参照、重複定義など（初期は控えめに）。parser の構文診断とマージ。
- オペコード/型のドキュメント辞書を持ち、Hover/Completion で再利用。
- 公開API例: `analyze(ast): SemanticModel`、`SemanticModel.definitionAt(pos)` / `referencesOf(symbol)` / `symbolAt(pos)` / `documentSymbols()` / `diagnostics()`

### language-server（アダプタ）

- `vscode-languageserver/node` + `vscode-languageserver-textdocument`。stdio/IPC で起動。
- ドキュメント変更をデバウンスして全体再パース（初期はインクリメンタル無し）。
- capability ↔ analyzer クエリの対応:
  - `hover` ← `symbolAt` + 型/ドキュメント辞書
  - `definition` / `references` ← 定義/参照インデックス
  - `documentSymbol` ← `documentSymbols`
  - `semanticTokens/full` ← トークン分類
  - `publishDiagnostics` ← `diagnostics`
  - `completion` ← オペコード/型キーワード/スコープ内識別子
  - `rename` / `prepareRename` ← 参照インデックス
  - `foldingRange` ← 関数/ブロック範囲

### vscode-extension（配布物）

- `contributes.languages`（id `llvm`, `.ll`）/ `contributes.grammars`（`source.llvm`）/ `language-configuration.json`。
- TextMate文法は **LSP無しでも色が付く土台**。将来は Semantic Tokens で強調を上書き。
- 将来 `src/extension.ts` で `vscode-languageclient/node` を使い language-server を子プロセス起動。

## LLVM IR固有のパース勘所

- **`%foo` の曖昧性**: 「ローカル値」と「名前付き型」の両方になりうる。出現位置（型位置 vs 値位置）で区別する。
- **数値ID**: グローバル/ローカルとも `@1`, `%2` のような暗黙の連番IDを取りうる。
- **ラベル（基本ブロック）**: ブロック先頭 `name:` で定義、`br label %name` 等で参照。
- **スコープ**:
  - モジュールスコープ: `@`グローバル / 名前付き型 / 名前付きメタデータ / 属性グループ `#`。
  - 関数スコープ: `%`ローカル（パラメータ含む） / ラベル。

## 配布

`@vscode/vsce` で `.vsix` をパッケージ。バンドルは language-server 導入時に esbuild を採用予定。
