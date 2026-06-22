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

- **lexer**: 状態遷移表ベースのトークナイザ。各トークンに `range`（line/column/offset）を保持。
  - トークン種別: グローバル識別子 `@name`/`@"..."`/`@1`、ローカル識別子 `%name`/`%1`、ラベル、
    メタデータ `!name`/`!0`、属性グループ `#0`、comdat `$name`、
    型キーワード (`i32`, `ptr`, `void`, `float`…)、命令オペコード、数値、文字列、コメント (`;`)、記号。
- **ast**: ノード型定義（Module / TypeDef / GlobalVar / FunctionDef / FunctionDecl / BasicBlock / Instruction / Operand / Metadata…）。各ノードに `range`。
- **parser**: 再帰下降パーサ。**エラー回復付き**（1命令の失敗で全体を止めない）で構文エラーを診断として収集。
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
