# 初回プラン: 基盤 + シンタックスハイライト

> このファイルは実行したプランをログとして残すものです。以後、プランごとに `docs/plans/` に追記していきます。

## Context

LLVM IR (`.ll`) 編集の開発体験を向上させるLSP付きVSCode拡張機能を新規開発する。
最終的には シンタックスハイライト / 定義ジャンプ・参照検索 / ホバー・アウトライン / 診断・補完・リネーム を提供したいが、
**今回は最小実装に絞る**: 開発基盤（モノレポ足場・ツール・CI）を整え、LSP不要で実現できる**TextMateシンタックスハイライト**だけを動く状態にする。
残りの機能はステップバイステップで実装できるよう、全体設計を `docs/design.md`、Todoを `docs/roadmap.md` に残す。

解析の知能の土台は将来的に **自前のTypeScriptパーサ**（AGENTS.md の古典派TDD・関心の分離と整合）。対象は最新安定 (LLVM 18+, opaque pointer `ptr` 前提)。

## 今回のスコープ

### 1. モノレポ足場 + ツール

- `mise.toml`: `node` 24, `pnpm`, `pinact`, `lefthook` をバージョン固定で管理
- `pnpm-workspace.yaml`: `packages/*` + サプライチェーン対策設定
  - `minimumReleaseAge`: 公開直後の新バージョンを一定時間インストールしない
  - `onlyBuiltDependencies`: ライフサイクルスクリプトを明示allowlistのみ許可
  - `dangerouslyAllowAllBuilds: false`、`verifyDepsBeforeRun`
- `.npmrc`: `verify-store-integrity=true`
- ルート `package.json`: scripts集約、`packageManager` でpnpm固定
- `pnpm-lock.yaml` をコミットし、CIは `--frozen-lockfile`
- `tsconfig.base.json`、`.oxlintrc.json`、`.oxfmtrc.json`
- `lefthook.yml`: pre-commit = oxfmt + oxlint + typecheck、pre-push = test
- `.github/workflows/ci.yml`: mise-action → frozen install → lint/format/typecheck/test/build。全 `uses:` を pinact でSHAピン留め、`pinact run --check` で検証

### 2. `packages/vscode-extension`（今回動かす唯一のパッケージ）

- `package.json` contributes: `languages`(id `llvm`, `.ll`), `grammars`(`source.llvm`)
- `language-configuration.json`: 行コメント `;`、括弧、autoClosing/surrounding
- `syntaxes/llvm.tmLanguage.json`: **今回の主役 = シンタックスハイライト**
- `examples/*.ll`: 動作確認用サンプル
- 宣言のみで動くため、今回 `main`/`extension.ts` は持たない（LSPクライアント配線は将来フェーズ）

### 3. ドキュメント

- `docs/plans/`: 各プランをログとして保存（本ファイル）
- `docs/design.md`: 全体アーキテクチャ設計
- `docs/roadmap.md`: ロードマップ/Todo

## 検証

- `pnpm install --frozen-lockfile` / `pnpm lint` / `pnpm format` / `pnpm typecheck` / `pnpm test`
- `pinact run --check` が通る（全 `uses:` がSHAピン）
- `F5`（Extension Development Host）で `examples/*.ll` のハイライトと言語認識を目視確認
