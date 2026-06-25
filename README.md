# llvm-analyzer

`llvm-analyzer` は LLVM IR (`.ll`) 向けの VSCode 拡張機能です。
シンタックスハイライトと Language Server を同梱し、生成済み IR や手書き IR を VSCode 上で読みやすくします。

この README は、利用者向けの情報と開発者向けの情報を分けています。
拡張機能を使うだけなら「利用者向け」だけを読めば足ります。
リポジトリを変更する場合は「開発者向け」へ進んでください。

## 利用者向け

### 機能

| 分類         | 機能                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| 表示         | `.ll` ファイルのシンタックスハイライト、Semantic Tokens、Folding Range                               |
| 読解         | 宣言形 hover、opcode/type/attribute hover、定義ジャンプ、参照検索、Document Symbol、Workspace Symbol |
| 編集         | 補完、Rename、Format、Range Format                                                                   |
| 診断         | parser 診断、analyzer 診断、外部 LLVM verifier 診断                                                  |
| 補助表示     | SSA 値の推定型を表示する Inlay Hints                                                                 |
| ファイル参照 | `source_filename` と `!DIFile` から実在ファイルを開く Document Link                                  |
| 呼び出し関係 | `call`、`invoke`、`callbr` の直接呼び出しを辿る Call Hierarchy                                       |
| 制御フロー   | 現在関数の Control Flow Graph を Mermaid として表示するコマンド                                      |
| Quick Fix    | 未定義の近いグローバル名やラベル名への置換、終端命令後の命令削除                                     |

### 対応する LLVM IR

| 対象              | 対応                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| ポインタ          | opaque pointer の `ptr` を標準として扱う。古い typed pointer 記法も寛容にパースする。                      |
| 型構文            | scalar、pointer、vector、array、struct、function type、named type、opaque struct を軽量な AST として扱う。 |
| 最新 LangRef 差分 | `ptrtoaddr`、byte type `bN`、debug record、comdat、use-list order、`ptr addrspace(N)` 引数を扱う。         |
| 複数行構文        | 複数行グローバル初期化子、複数行 debug record、複数行 switch を構造解析する。                              |
| ラベル参照        | PHI incoming と `blockaddress` のラベル参照を SSA 値参照と区別する。                                       |

診断は編集時に効く軽量な構造解析と名前解決に絞っています。
未定義参照、重複定義、同一命令内の自己参照、終端命令後の通常命令などは検出します。
ただし、target datalayout に依存する型検査や LLVM verifier 相当の完全な検証は扱いません。

### 動作確認

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

### VSCode Marketplace への公開

Marketplace 公開は [`.github/workflows/publish-vscode.yml`](.github/workflows/publish-vscode.yml) で行います。
長期 PAT は使わず、GitHub Actions の OIDC token を Microsoft Entra の federated credential と交換し、`vsce publish --azure-credential` で公開します。

公開ワークフローは次の方針です。

| 項目         | 方針                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| 実行条件     | 手動実行、または prerelease ではない GitHub Release の公開                                                       |
| 権限         | 既定は `contents: read`。Marketplace 公開 job だけ `id-token: write` を付与                                      |
| 環境         | `vscode-marketplace` environment を使い、必要なら reviewer / protected branch を設定する                         |
| 認証         | `vars.AZURE_CLIENT_ID` と `vars.AZURE_TENANT_ID` で Entra identity を指定し、secret は保存しない                 |
| パッケージ   | 権限なしの job で VSIX を作成し、checksum を記録して artifact 化する                                             |
| 公開         | 公開 job では artifact の checksum を検証し、依存 install は `--ignore-scripts` で lifecycle script を実行しない |
| Actions 固定 | 外部 GitHub Actions は full-length commit SHA で固定する                                                         |

Entra 側の federated credential は GitHub environment に紐づけます。
このリポジトリでは subject を次の形に固定する想定です。

```text
repo:r4ai/llvm-analyzer:environment:vscode-marketplace
```

Marketplace 側では、同じ identity が `r4ai` publisher の拡張機能を公開できるように設定します。
GitHub repository variables には次を設定します。

| 変数              | 内容                                       |
| ----------------- | ------------------------------------------ |
| `AZURE_CLIENT_ID` | Entra application / managed identity の ID |
| `AZURE_TENANT_ID` | Entra tenant ID                            |

### LLVM verifier 連携

| 項目                 | 内容                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| 既定のコマンド       | `llvm-as -o {devNull} -`                                                     |
| 実行条件             | PATH 上に `llvm-as` があり、外部 verifier 診断が有効であること               |
| 実行タイミング       | 編集停止後に language server がバックグラウンドで実行する                    |
| `llvm-as` がない場合 | 外部 verifier 診断だけを出さず、parser と analyzer の診断を使う              |
| 代替コマンド         | `llvm-analyzer.verifier.command` と `llvm-analyzer.verifier.args` で変更する |

たとえば `opt -passes=verify -disable-output -` のような verifier コマンドに差し替えられます。

### 設定

| 設定                                          | 内容                                             |
| --------------------------------------------- | ------------------------------------------------ |
| `llvm-analyzer.verifier.enabled`              | 外部 verifier 連携を有効にする。                 |
| `llvm-analyzer.verifier.command`              | verifier として実行するコマンド。                |
| `llvm-analyzer.verifier.args`                 | verifier コマンドへ渡す引数。                    |
| `llvm-analyzer.verifier.debounceMs`           | 編集停止後に verifier を起動するまでの待ち時間。 |
| `llvm-analyzer.verifier.timeoutMs`            | verifier の実行を打ち切るまでの時間。            |
| `llvm-analyzer.verifier.maxFileBytes`         | 自動 verifier を実行する最大ファイルサイズ。     |
| `llvm-analyzer.diagnostics.parser.enabled`    | parser 由来の構文診断を有効にする。              |
| `llvm-analyzer.diagnostics.parser.severity`   | parser 由来の構文診断の重大度。                  |
| `llvm-analyzer.diagnostics.analyzer.enabled`  | analyzer 由来の意味診断を有効にする。            |
| `llvm-analyzer.diagnostics.analyzer.severity` | analyzer 由来の意味診断の重大度。                |
| `llvm-analyzer.diagnostics.verifier.enabled`  | 外部 verifier 由来の診断を有効にする。           |
| `llvm-analyzer.diagnostics.verifier.severity` | 外部 verifier 由来の診断の重大度。               |
| `llvm-analyzer.inlayHints.types.enabled`      | SSA 値の推定型 Inlay Hints を表示する。          |

## 開発者向け

### 設計方針

このリポジトリは pnpm workspace のモノレポです。
LLVM IR の parser と analyzer は VSCode や LSP に依存しない純粋なパッケージとして分離し、拡張機能と language server はその結果をエディタ機能へ変換します。

依存方向は `vscode-extension -> language-server -> analyzer -> parser` です。
parser と analyzer は VSCode API に依存しません。

### リポジトリ構成

| パッケージ                  | 責務                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `packages/parser`           | `source -> tokens -> AST`。副作用を持たない LLVM IR parser。 |
| `packages/analyzer`         | `AST -> 意味モデル`。シンボル表、参照、型推定、診断を扱う。  |
| `packages/language-server`  | analyzer を LSP へ接続するアダプタ。                         |
| `packages/vscode-extension` | VSCode 拡張機能、TextMate 文法、設定、E2E。                  |

### 開発環境

Node.js、pnpm、lefthook、pinact は [mise](https://mise.jdx.dev/) で管理します。

```sh
mise install
pnpm install
```

`pnpm install` 時に lefthook の Git hook が設定されます。

### コマンド

| コマンド                                      | 用途                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm lint`                                   | oxlint を実行する。                                                                 |
| `pnpm format`                                 | oxfmt の check を実行する。                                                         |
| `pnpm typecheck`                              | TypeScript の型検査を実行する。                                                     |
| `pnpm test`                                   | Vitest を実行する。                                                                 |
| `pnpm test:coverage`                          | Vitest とカバレッジ計測を実行する。                                                 |
| `pnpm build`                                  | workspace 全体の build を実行する。                                                 |
| `pnpm --filter llvm-analyzer-vscode test:e2e` | VSCode Extension Host で fixture workspace を開き、主要 LSP 経路の E2E を実行する。 |
| `pnpm --filter llvm-analyzer-vscode package`  | VSCode 拡張機能の `.vsix` を作成する。                                              |

### CI とサプライチェーン対策

| 対象                | 対策                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| 依存解決            | CI とローカル導入で `--frozen-lockfile` を使う。                                           |
| 公開直後の依存      | pnpm の `minimumReleaseAge` で、公開直後の依存バージョンをすぐ取り込まない。               |
| 依存の build script | pnpm の `allowBuilds` で、許可した依存だけにビルドスクリプト実行を認める。                 |
| GitHub Actions      | [pinact](https://github.com/suzuki-shunsuke/pinact) で `uses:` をコミット SHA に固定する。 |
| CI 検査             | lint、format、typecheck、test、build、`pinact run --check` を実行する。                    |

### ドキュメント

| 文書                                                                       | 内容                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| [docs/design.md](docs/design.md)                                           | アーキテクチャ、パッケージ責務、LSP 機能の対応関係。 |
| [docs/roadmap.md](docs/roadmap.md)                                         | 実装済みフェーズと残タスクの管理。                   |
| [docs/plans/](docs/plans/)                                                 | 各フェーズの実行ログ。ファイル名は古い順の連番。     |
| [packages/vscode-extension/README.md](packages/vscode-extension/README.md) | VSCode 拡張機能としての機能と設定。                  |

## ライセンス

このリポジトリは [MIT License](LICENSE) で公開しています。
