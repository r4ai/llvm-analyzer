# VSCode E2E カバレッジ拡充

## Context

既存の E2E は VSCode extension host を起動し、サンプル `.ll` の hover、definition、rename、inlay hint、CFG 表示を確認している。

一方で、利用者が拡張機能として触る全体動作には、completion、document symbol、workspace symbol、diagnostics、quick fix、format、document link、call hierarchy も含まれる。

これらは parser、analyzer、language-server、vscode-extension をまたぐため、ユニットテストだけでは配線の欠落を検出しにくい。

## スコープ

今回やること:

- `@vscode/test-electron` の E2E で fixture workspace を開けるようにする。
- fixture workspace に複数の `.ll` ファイルと document link 用の実在ファイルを置く。
- VSCode の公開 command 経由で、主要 LSP provider と VSCode command の代表経路を確認する。
- 外部 LLVM verifier は fixture の workspace 設定で無効化し、環境依存の診断差分を避ける。

今回やらないこと:

- VSCode UI の描画差分やスクリーンショット検証は扱わない。
- 全 opcode、全型構文、全 diagnostic code を E2E で網羅しない。
- 外部 `llvm-as` の実行有無に依存する E2E は追加しない。

## 検証方法

- 追加した E2E を先に実行し、workspace 起動前提が満たされない状態で失敗することを確認する。
- `pnpm --filter llvm-analyzer-vscode test:e2e` を通す。
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`
