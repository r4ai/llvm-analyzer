# VSCode Marketplace OIDC 公開ワークフロー

## Context

VSCode Marketplace への公開を PAT ではなく OIDC ベースにし、長期 secret を GitHub Actions に置かない運用へ移行する。
あわせて、公開 job の権限・実行条件・VSIX 内容を絞り、サプライチェーン攻撃時の影響範囲を小さくする。

## スコープ

今回やること:

- GitHub Actions から Microsoft Entra federated credential を使って `vsce publish --azure-credential` を実行する公開ワークフローを追加する。
- VSIX 作成 job と Marketplace 公開 job を分離し、OIDC token を公開 job だけに付与する。
- GitHub Actions は full-length SHA で固定し、`GITHUB_TOKEN` 権限を最小化する。
- Marketplace 公開に必要な拡張 manifest と VSIX 同梱対象を整える。
- README / design / roadmap に公開手順と運用上の前提を記録する。

今回やらないこと:

- Microsoft Entra / Azure DevOps / Visual Studio Marketplace 側の実リソース作成。
- Open VSX Registry への公開。
- GitHub Release 作成の自動化。

## 検証方法

- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm --filter llvm-analyzer-vscode package`
- `pinact run --check`
