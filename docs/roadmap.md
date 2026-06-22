# ロードマップ / Todo

各フェーズはステップバイステップで実装する。詳細設計は [design.md](./design.md)、各回の実行ログは [plans/](./plans/) を参照。

## フェーズ

- [x] **基盤 + シンタックスハイライト**（2026-06-22）
  - モノレポ足場（mise / pnpm workspace + サプライチェーン対策 / oxlint / oxfmt / lefthook / CI + pinact）
  - `packages/vscode-extension`: TextMate文法による `.ll` のシンタックスハイライト、`language-configuration.json`、サンプル
- [x] **parser: lexer**（2026-06-22）
  - `packages/parser` 新設。`tokenize(source): Token[]`（純粋関数、末尾に `Eof`、不正文字は `Unknown` で回復）
  - トークン: `@`/`%`/`!`/`#`/`$` 識別子、ラベル、型キーワード、オペコード、定数、数値、文字列、コメント、記号。各トークンに `range`（offset/line/column, 0始まり）
  - 状態遷移表から網羅的にテスト設計（探索 → Red → Green → Refactor）。カバレッジは行/文/関数100%
- [x] **parser: AST + 再帰下降パーサ**（2026-06-22）
  - `parseModule(source): { ast: Module; diagnostics: ParseDiagnostic[] }`（純粋関数）。トップレベルは行ベース、`define` 本体のみ `{}` ブロック
  - AST: Module / 各トップレベルエントリ（SourceFilename / TargetDefinition / TypeDefinition / GlobalVariable / FunctionDeclaration / FunctionDefinition / AttributeGroupDefinition / MetadataDefinition / UnknownEntry）/ BasicBlock / Instruction / IdentifierRef。各ノードに `range`
  - 粒度は「構造重視・命令は粗く」: 命令・型の内部は構造化せず、出現する識別子参照（`@`/`%`/`!`/`#`/`$`・ラベル）を収集。型解決は analyzer へ
  - エラー回復付き（1行の失敗で全体を止めず `UnknownEntry`＋診断で継続）。構文パターンから網羅的にテスト設計
- [ ] **analyzer: 意味モデル**
  - シンボル表 / スコープ（モジュール・関数）/ 定義参照インデックス / 型解決 / 診断
  - オペコード・型のドキュメント辞書
- [ ] **language-server: LSPサーバ**
  - hover / definition / references / documentSymbol / semanticTokens / publishDiagnostics / completion / rename / foldingRange
  - 変更のデバウンス再パース
- [ ] **vscode-extension: LSPクライアント配線**
  - `vscode-languageclient/node` で language-server を起動。esbuild バンドル導入
- [ ] **E2E + 配布**
  - `@vscode/test-electron` によるE2E（`.ll` を開いて hover/definition を検証）
  - README 充実、`@vscode/vsce` で `.vsix` パッケージ

## メモ

- テストはテスティングピラミッドに従い、ユニット（lexer/parser/analyzer）を厚く、結合（source→LSPクエリ）を中程度、E2E（extension host）を薄く。
- 対象は最新安定 LLVM IR（opaque pointer `ptr`）。typed pointer は寛容にパースするが警告しない。
- コメント/ドキュメントは日本語、JSDocで記述（AGENTS.md準拠）。
