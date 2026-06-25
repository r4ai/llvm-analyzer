---
name: release-workflow
description: Repository-specific release workflow for llvm-analyzer. Use when adding or checking Changesets, preparing Version PRs, diagnosing GitHub Actions release jobs, publishing the VSCode Marketplace extension with OIDC, or changing release/version/changelog automation.
---

# Release Workflow

## Overview

このリポジトリは Changesets で `llvm-analyzer-vscode` の version と changelog を作り、GitHub Actions OIDC で VSCode Marketplace に公開する。
長期 PAT は使わず、Marketplace publish は `vscode-marketplace` environment で保護する。

## 通常変更の手順

1. 利用者へ届く変更か判断する。
2. 届く場合は `pnpm changeset` を実行し、対象 package に `llvm-analyzer-vscode` を含める。
3. parser / analyzer / language-server の変更でも、VSCode 拡張に同梱されて利用者へ届くなら `llvm-analyzer-vscode` を含める。内部 package の version / changelog が必要な場合だけ内部 package も選ぶ。
4. 影響度は SemVer で選ぶ。
   - `patch`: bug fix、診断精度改善、軽微な UX 改善。
   - `minor`: 新機能、設定追加、対応構文の追加。
   - `major`: 互換性を壊す設定・挙動・サポート範囲の変更。
5. リリース不要の CI / test / docs / internal cleanup では `pnpm changeset --empty` を追加する。
6. PR では `pnpm changeset status --since=origin/main` が通ることを確認する。

## Version PR と公開

1. changeset を含む PR が `main` に merge される。
2. `.github/workflows/release.yml` の `changesets` job が `changeset version` を実行し、`chore: version packages` PR を作る。
3. Version PR では `packages/vscode-extension/package.json` と `packages/vscode-extension/CHANGELOG.md` を確認する。
4. Version PR を merge すると、同じ workflow が `packages/vscode-extension/package.json` の変更と未作成 tag `llvm-analyzer-vscode@<version>` を検出して VSIX を作る。
5. `publish` job だけが `id-token: write` を持ち、`azure/login` と `vsce publish --azure-credential --skip-duplicate` を実行する。
6. Marketplace publish 後に GitHub Release を作成し、VSIX を添付する。

## 安全性の前提

- 外部 GitHub Actions は full-length commit SHA で固定する。
- `id-token: write` は Marketplace publish job だけに付与する。
- VSIX 作成 job と publish job は分離し、publish job は checksum を検証する。
- publish job の依存 install は `pnpm install --frozen-lockfile --ignore-scripts` にする。
- `vscode-marketplace` environment に reviewer / protected branch を設定する。
- GitHub repository variables に `AZURE_CLIENT_ID` と `AZURE_TENANT_ID` を設定する。
- Entra federated credential の subject は `repo:r4ai/llvm-analyzer:environment:vscode-marketplace` に固定する。

## 関連ファイル

- `.changeset/config.json`: Changesets 設定。Marketplace 公開判定は `llvm-analyzer-vscode`。
- `.github/workflows/ci.yml`: PR の changeset status と通常検証。
- `.github/workflows/release.yml`: Version PR 作成、OIDC publish、GitHub Release 作成。
- `.github/workflows/publish-vscode.yml`: 手動または GitHub Release 起点の Marketplace publish。
- `scripts/vscode-release-notes.mjs`: `CHANGELOG.md` から GitHub Release notes を抽出する。
