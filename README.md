# llvm-analyzer

LLVM IR (`.ll`) を読むための VSCode 拡張機能です。
TextMate 文法によるシンタックスハイライトに加えて、LLVM IR 向けの Language Server を同梱しています。

このリポジトリは pnpm workspace のモノレポです。
LLVM IR の parser と analyzer は VSCode や LSP に依存しない純粋なパッケージとして分離し、拡張機能と language server はその結果をエディタ機能へ変換します。

## できること

`llvm-analyzer` は、生成済み IR や手書き IR を VSCode 上で追いやすくすることを目的にしています。
LLVM verifier 全体を TypeScript で再実装するのではなく、編集時に効く軽量な構造解析と名前解決を提供します。

- `.ll` ファイルのシンタックスハイライト。
- hover、定義ジャンプ、参照検索、Document Symbol、Workspace Symbol。
- Semantic Tokens、補完、Rename、Folding Range。
- parser、analyzer、外部 LLVM verifier の診断。
- SSA 値の推定型を表示する Inlay Hints。
- `source_filename` と `!DIFile` から実在ファイルを開く Document Link。
- `call`、`invoke`、`callbr` の直接呼び出しを辿る Call Hierarchy。
- 関数単位の Control Flow Graph を Mermaid として表示するコマンド。
- 行頭、行末空白と関数内インデントを整える Format と Range Format。
- 未定義の近いグローバル名やラベル名への置換、終端命令後の命令削除を提示する Quick Fix。

## 解析対象

parser は最新の LLVM LangRef を主な対象にします。
opaque pointer の `ptr` を標準として扱い、古い typed pointer 記法も寛容にパースします。

現在は、`ptrtoaddr`、byte type `bN`、debug record、comdat、use-list order、複数行グローバル初期化子、`ptr addrspace(N)` 引数、PHI と `blockaddress` のラベル参照などを構造解析します。
型構文は scalar、pointer、vector、array、struct、function type、named type、opaque struct を軽量な AST として扱います。

診断は LSP で即時に返せる範囲に絞っています。
未定義参照、重複定義、同一命令内の自己参照、終端命令後の通常命令などは検出しますが、target datalayout に依存する型検査や LLVM verifier 相当の完全な検証は扱いません。

## すぐ試す

このリポジトリから拡張機能を動かす場合は、VSCode の Extension Development Host を使います。

```sh
mise install
pnpm install
pnpm --filter llvm-analyzer-vscode build
```

VSCode でこのリポジトリを開き、`F5` で Extension Development Host を起動します。
起動後のウィンドウで [packages/vscode-extension/examples/hello.ll](packages/vscode-extension/examples/hello.ll) を開くと、シンタックスハイライトと LSP 機能を確認できます。

`.vsix` を作る場合は次のコマンドを使います。

```sh
pnpm --filter llvm-analyzer-vscode package
```

生成物は `packages/vscode-extension/llvm-analyzer-vscode.vsix` です。

## LLVM verifier 連携

既定では、PATH 上に `llvm-as` がある場合に外部 verifier 診断を追加します。
language server は編集停止後に `llvm-as -o {devNull} -` をバックグラウンドで実行し、parser と analyzer の診断へ結果をマージします。

`llvm-as` が見つからない場合、外部 verifier 診断だけを出さずに処理を続けます。
parser と analyzer の診断、シンタックスハイライト、定義ジャンプなどはそのまま使えます。

`llvm-analyzer.verifier.command` と `llvm-analyzer.verifier.args` を変更すると、別の verifier コマンドも使えます。
たとえば `opt -passes=verify -disable-output -` のような構成にできます。

## 設定

VSCode の設定から次の項目を変更できます。

- `llvm-analyzer.verifier.enabled`：外部 verifier 連携を有効にする。
- `llvm-analyzer.verifier.command`：verifier として実行するコマンド。
- `llvm-analyzer.verifier.args`：verifier コマンドへ渡す引数。
- `llvm-analyzer.verifier.debounceMs`：編集停止後に verifier を起動するまでの待ち時間。
- `llvm-analyzer.verifier.timeoutMs`：verifier の実行を打ち切るまでの時間。
- `llvm-analyzer.verifier.maxFileBytes`：自動 verifier を実行する最大ファイルサイズ。
- `llvm-analyzer.diagnostics.parser.enabled`：parser 由来の構文診断を有効にする。
- `llvm-analyzer.diagnostics.parser.severity`：parser 由来の構文診断の重大度。
- `llvm-analyzer.diagnostics.analyzer.enabled`：analyzer 由来の意味診断を有効にする。
- `llvm-analyzer.diagnostics.analyzer.severity`：analyzer 由来の意味診断の重大度。
- `llvm-analyzer.diagnostics.verifier.enabled`：外部 verifier 由来の診断を有効にする。
- `llvm-analyzer.diagnostics.verifier.severity`：外部 verifier 由来の診断の重大度。
- `llvm-analyzer.inlayHints.types.enabled`：SSA 値の推定型 Inlay Hints を表示する。

## リポジトリ構成

```text
packages/
├── parser/           # source -> tokens -> AST。副作用を持たない LLVM IR parser。
├── analyzer/         # AST -> 意味モデル。シンボル表、参照、型推定、診断を扱う。
├── language-server/  # analyzer を LSP へ接続するアダプタ。
└── vscode-extension/ # VSCode 拡張機能、TextMate 文法、設定、E2E。
```

依存方向は `vscode-extension -> language-server -> analyzer -> parser` です。
parser と analyzer は VSCode API に依存しません。

## 開発

Node.js、pnpm、lefthook、pinact は [mise](https://mise.jdx.dev/) で管理します。

```sh
mise install
pnpm install
```

主なコマンドは次の通りです。

```sh
pnpm lint
pnpm format
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm --filter llvm-analyzer-vscode test:e2e
pnpm --filter llvm-analyzer-vscode package
```

`pnpm install` 時に lefthook の Git hook が設定されます。
CI では lint、format、typecheck、test、build、pinact の検査を実行します。

## ドキュメント

- [docs/design.md](docs/design.md)：アーキテクチャ、パッケージ責務、LSP 機能の対応関係。
- [docs/roadmap.md](docs/roadmap.md)：実装済みフェーズと残タスクの管理。
- [docs/plans/](docs/plans/)：各フェーズの実行ログ。
- [packages/vscode-extension/README.md](packages/vscode-extension/README.md)：VSCode 拡張機能としての機能と設定。

## サプライチェーン対策

依存関係と CI の更新は、意図しない実行や差し替えを避ける前提で管理しています。

- pnpm の `minimumReleaseAge` で、公開直後の依存バージョンをすぐ取り込まない。
- pnpm の `allowBuilds` で、許可した依存だけにビルドスクリプト実行を認める。
- CI とローカル導入では `--frozen-lockfile` を使い、lockfile と実際の依存解決を一致させる。
- GitHub Actions の `uses:` は [pinact](https://github.com/suzuki-shunsuke/pinact) でコミット SHA に固定し、CI で `pinact run --check` を実行する。
