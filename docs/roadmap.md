# ロードマップ / Todo

各フェーズはステップバイステップで実装する。詳細設計は [design.md](./design.md)、各回の実行ログは [plans/](./plans/) を参照。

## フェーズ

- [x] **基盤 + シンタックスハイライト**（2026-06-22）
  - モノレポ足場（mise / pnpm workspace + サプライチェーン対策 / oxlint / oxfmt / lefthook / CI + pinact）
  - `packages/vscode-extension`: TextMate文法による `.ll` のシンタックスハイライト、`language-configuration.json`、サンプル
- [ ] **parser: lexer**
  - 状態遷移表から網羅的にテストケースを設計（探索 → Red → Green → Refactor）
  - トークン: `@`/`%`/`!`/`#`/`$` 識別子、型キーワード、オペコード、数値、文字列、コメント、記号。各トークンに `range`
- [ ] **parser: AST + 再帰下降パーサ**
  - ノード型定義、エラー回復付きパース、構文診断の収集
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
