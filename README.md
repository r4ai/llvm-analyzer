# llvm-analyzer

LLVM IR (`.ll`) 向けの LSP 機能を提供する VSCode 拡張機能。

現在はシンタックスハイライトと、純粋ドメイン層の parser / analyzer を提供。LSP 経由の定義ジャンプ・参照検索・ホバー・アウトライン・診断・補完・リネームを順次実装予定。

- 全体設計: [docs/design.md](docs/design.md)
- ロードマップ: [docs/roadmap.md](docs/roadmap.md)
- 各回の実行ログ: [docs/plans/](docs/plans/)

## 開発

ツールは [mise](https://mise.jdx.dev/) で管理する（Node 24 / pnpm / lefthook / pinact）。

```sh
mise install            # ツールチェーンを導入
pnpm install            # 依存をインストール（git hook も設定される）
pnpm lint               # oxlint
pnpm format             # oxfmt --check
pnpm typecheck          # tsc
pnpm test               # vitest
pnpm test:coverage      # vitest + カバレッジ（v8）
```

### 拡張機能の動作確認

VSCode で本リポジトリを開き、`F5`（Extension Development Host）を起動して
[packages/vscode-extension/examples/hello.ll](packages/vscode-extension/examples/hello.ll) を開くと、
シンタックスハイライトが確認できる。

## サプライチェーン対策

- pnpm: `minimumReleaseAge`（公開直後の新バージョンを取り込まない）、`onlyBuiltDependencies`（ライフサイクルスクリプトを許可制）、`--frozen-lockfile`。
- GitHub Actions: [pinact](https://github.com/suzuki-shunsuke/pinact) で全 `uses:` をコミットSHAにピン留めし、CI で `pinact run --check` を検証。
