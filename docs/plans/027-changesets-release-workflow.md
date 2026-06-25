# Changesets リリースワークフロー

## Context

VSCode Marketplace への OIDC 公開は設定済みだが、いつ version を上げ、どの変更を release note に載せるかを手動で判断する状態だった。
Changesets を導入し、変更 PR の時点で SemVer impact と changelog を記録し、Version PR の review を経て Marketplace 公開できるようにする。

## スコープ

今回やること:

- `@changesets/cli` と `.changeset/config.json` を導入する。
- PR に changeset または empty changeset を要求する CI チェックを追加する。
- `main` push で Version PR を作成し、Version PR merge 後に VSIX 作成、OIDC Marketplace publish、GitHub Release 作成を行う workflow を追加する。
- GitHub Release notes を `packages/vscode-extension/CHANGELOG.md` から抽出するスクリプトを追加する。
- README / design / roadmap と repo skill に運用手順を記録する。

今回やらないこと:

- npm への package publish。
- Open VSX Registry への publish。
- pre-release / snapshot release の自動化。

## 検証方法

- `pnpm install --frozen-lockfile --ignore-scripts`
- `pnpm changeset status --since=HEAD`
- `pnpm version-packages` の一時実行と差分復元
- `node scripts/vscode-release-notes.mjs`
- `pnpm lint`
- `pnpm format`
- `pnpm typecheck`
- `pnpm test`
- `pnpm --filter llvm-analyzer-vscode package`
- workflow YAML parse と full-length SHA 固定チェック
