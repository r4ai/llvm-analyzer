# llvm-analyzer

LLVM IR (`.ll`) 向けの LSP 機能を提供する VSCode 拡張機能。

現在はシンタックスハイライトに加えて、LSP 経由の hover / definition / references / documentSymbol / semanticTokens / diagnostics / completion / rename / foldingRange を提供する。
解析ロジックは純粋ドメイン層の parser / analyzer として分離している。
最新 LLVM LangRef に追従し、`ptrtoaddr`、byte type `bN`、debug record、comdat、use-list order、複数行グローバル初期化子などを構造解析する。
診断は LSP 用の軽量な名前解決と最小限の well-formedness に絞り、LLVM verifier 全体の再実装はしない。

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
pnpm --filter llvm-analyzer-vscode build      # 拡張機能と language-server をバンドル
pnpm --filter llvm-analyzer-vscode test:e2e   # VSCode Extension Host で hover / definition を検証
pnpm --filter llvm-analyzer-vscode package    # .vsix を作成
```

### 拡張機能の動作確認

VSCode で本リポジトリを開き、`F5`（Extension Development Host）を起動して
[packages/vscode-extension/examples/hello.ll](packages/vscode-extension/examples/hello.ll) を開くと、
シンタックスハイライトと LSP 機能が確認できる。

## サプライチェーン対策

- pnpm: `minimumReleaseAge`（公開直後の新バージョンを取り込まない）、`onlyBuiltDependencies`（ライフサイクルスクリプトを許可制）、`--frozen-lockfile`。
- GitHub Actions: [pinact](https://github.com/suzuki-shunsuke/pinact) で全 `uses:` をコミットSHAにピン留めし、CI で `pinact run --check` を検証。
