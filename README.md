# llvm-analyzer

LLVM IR (`.ll`) 向けの LSP 機能を提供する VSCode 拡張機能。

現在はシンタックスハイライトに加えて、LSP 経由の hover / definition / references / documentSymbol / documentLink / semanticTokens / diagnostics / completion / rename / foldingRange / formatting を提供する。
解析ロジックは純粋ドメイン層の parser / analyzer として分離している。
最新 LLVM LangRef に追従し、`ptrtoaddr`、byte type `bN`、debug record、comdat、use-list order、複数行グローバル初期化子、`ptr addrspace(N)` 引数、PHI / `blockaddress` のラベル参照などを構造解析する。
LLVM IR 型構文は scalar / pointer / vector / array / struct / function type / named type / opaque struct を軽量に AST 化し、複合型の hover / completion 表示にも利用する。
診断は LSP 用の軽量な名前解決と最小限の well-formedness に絞り、LLVM verifier 全体の再実装はしない。
PATH 上に `llvm-as` がある場合は、編集停止後に外部 LLVM verifier を実行し、追加診断として表示する。
parser / analyzer / external verifier の診断は、ソースごとに有効化と重大度を設定できる。
SSA 値の推定型は Inlay Hints として表示でき、設定で無効化できる。
ワークスペース内の `.ll` ファイルにある関数・グローバル・名前付き型・メタデータなどは Workspace Symbols で検索できる。
`call` / `invoke` / `callbr` の直接呼び出しは Call Hierarchy で callers / callees を辿れる。
`source_filename` と `!DIFile` の実在ファイルは Document Link として開ける。
行頭・行末空白と関数内インデントは Format / Range Format で安定化できる。
現在関数の Control Flow Graph は Mermaid として表示できる。
未定義の近いグローバル・ラベル名への置換や、終端命令後の命令削除は Quick Fix として提示する。

- 全体設計: [docs/design.md](docs/design.md)
- ロードマップ: [docs/roadmap.md](docs/roadmap.md)
- 各回の実行ログ: [docs/plans/](docs/plans/)

## 開発

Node 24 / lefthook / pinact は [mise](https://mise.jdx.dev/) で管理する。
pnpm はルート `package.json` の `packageManager` で固定し、Corepack 経由で使う。

```sh
mise install            # ツールチェーンを導入
corepack enable         # packageManager の pnpm を有効化
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

### LLVM verifier 連携

既定では `llvm-analyzer.verifier.enabled` が true の場合に、`llvm-as -o {devNull} -` をバックグラウンドで実行する。
`llvm-as` が PATH に無ければ外部 verifier 診断は出さず、既存の parser/analyzer 診断だけを使う。
`llvm-analyzer.verifier.command` と `llvm-analyzer.verifier.args` を変えると、`opt -passes=verify -disable-output -` のような別コマンドも使える。

## サプライチェーン対策

- pnpm: `minimumReleaseAge`（公開直後の新バージョンを取り込まない）、`onlyBuiltDependencies`（ライフサイクルスクリプトを許可制）、`--frozen-lockfile`。
- GitHub Actions: [pinact](https://github.com/suzuki-shunsuke/pinact) で全 `uses:` をコミットSHAにピン留めし、CI で `pinact run --check` を検証。
