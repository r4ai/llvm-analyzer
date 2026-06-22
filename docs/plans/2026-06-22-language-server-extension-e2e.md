# language-server / VSCode クライアント / E2E 配布プラン

## Context

parser と analyzer が LLVM IR の構文・意味モデルを返せる状態になった。
次は VSCode から LSP 経由で hover / definition / references / documentSymbol / semanticTokens / diagnostics / completion / rename / foldingRange を使えるようにし、拡張機能として起動・検証・配布できる形へ進める。

## スコープ

今回やること:

- `packages/language-server` を追加し、TextDocument から parser / analyzer を再構築するドキュメントストアを実装する。
- LSP 機能を小さな純粋アダプタに分け、hover / definition / references / documentSymbol / semanticTokens / diagnostics / completion / rename / foldingRange をテスト可能にする。
- `vscode-languageserver` のサーバエントリを追加し、変更通知はデバウンスして再解析する。
- `packages/vscode-extension` に `vscode-languageclient/node` のクライアント起動コードと esbuild バンドルを追加する。
- `@vscode/test-electron` の E2E 足場と、`.ll` を開いて hover / definition を確認するテストを追加する。
- README / design / roadmap を更新し、`.vsix` 作成コマンドを用意する。

今回やらないこと:

- LLVM IR の完全な型解析や命令オペランドの詳細パース。
- リモート LSP や複数ワークスペースをまたぐシンボル解決。
- 公開マーケットプレイスへの実配布。

## 検証方法

- `pnpm --filter @llvm-analyzer/language-server test`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`
- `pnpm --filter llvm-analyzer-vscode build`
- `pnpm --filter llvm-analyzer-vscode package`

E2E は Electron / VSCode の取得が必要なので、環境で実行できる場合に `pnpm --filter llvm-analyzer-vscode test:e2e` で確認する。
