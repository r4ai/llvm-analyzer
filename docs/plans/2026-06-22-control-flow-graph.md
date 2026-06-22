# 2026-06-22 実装ログ: Control Flow Graph 表示

## Context

LLVM IR の関数内制御フローを、定義参照や call hierarchy とは別の視点で確認できるようにする。
このフェーズでは Webview の作り込みではなく、正しいグラフデータと Mermaid 出力を優先する。

## スコープ

やったこと:

- analyzer に関数単位の CFG モデルを追加した。
- `br` / `switch` / `indirectbr` / `invoke` / `callbr` の `label %bb` から、静的に分かる successor を抽出した。
- 暗黙 entry ブロックを `entry` として扱うようにした。
- CFG を Mermaid `flowchart TD` として出力する純粋関数を追加した。
- VSCode command `llvm-analyzer.showControlFlowGraph` を追加し、現在関数の CFG を untitled markdown document に表示するようにした。
- README、VSCode extension README、設計、ロードマップを更新した。

やらなかったこと:

- 関数ポインタや indirect target の完全解決。
- SSA def-use graph の可視化。
- Webview UI の作り込み。
- DOT 出力。

## テスト

- `packages/analyzer/src/semantic/control-flow.test.ts`
  - `br` / `ret` を含む基本 CFG。
  - `switch` の複数 successor。
  - 暗黙 entry ブロックと現在位置からの関数 CFG 検索。
  - Mermaid 出力。
- `packages/vscode-extension/test/suite/extension.test.ts`
  - command が現在関数の Mermaid を返す E2E。

## 検証

- `pnpm test -- packages/analyzer/src/semantic/control-flow.test.ts`
- `pnpm --filter llvm-analyzer-vscode test:e2e`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm typecheck`

## レビュー

- 別コンテキストのサブエージェントでレビューした。
- 終端命令中の全 `LabelRef` を successor にしていたため、`blockaddress(@f, %bb)` が CFG 辺になる指摘に対応した。終端命令の `label %bb` 形式だけを successor として抽出する。
- Mermaid node id がラベル名の正規化だけでは衝突する指摘に対応し、ブロック順 index ベースの `block_N` を使うようにした。
- `indirectbr` / `invoke` / `callbr`、未知ラベル除外、重複辺除去、Mermaid id 衝突・ラベルエスケープのテストを追加した。
- VSCode command の E2E に、Markdown document 表示と関数外 `undefined` の確認を追加した。
