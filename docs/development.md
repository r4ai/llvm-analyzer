# 開発者向け情報

この文書は `llvm-analyzer` の開発、検証、リリースに必要な情報をまとめます。
利用者向けの機能説明は [README.md](../README.md) にあります。

## 設計方針

このリポジトリは pnpm workspace のモノレポです。
LLVM IR の parser と analyzer は VSCode や LSP に依存しない純粋なパッケージとして分離し、拡張機能と language server はその結果をエディタ機能へ変換します。

依存方向は `vscode-extension -> language-server -> analyzer -> parser` です。
parser と analyzer は VSCode API に依存しません。

## リポジトリ構成

| パッケージ                  | 責務                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `packages/parser`           | `source -> tokens -> AST`。副作用を持たない LLVM IR parser。 |
| `packages/analyzer`         | `AST -> 意味モデル`。シンボル表、参照、型推定、診断を扱う。  |
| `packages/language-server`  | analyzer を LSP へ接続するアダプタ。                         |
| `packages/vscode-extension` | VSCode 拡張機能、TextMate 文法、設定、E2E。                  |

## 開発環境

Node.js、pnpm、lefthook、pinact、clang、llvm-as は [Devbox](https://www.jetify.com/devbox) で管理します。

```sh
devbox shell
pnpm install
```

`pnpm install` 時に lefthook の Git hook が設定されます。
一時的なコマンド実行だけなら `devbox run -- pnpm test` のように実行します。
clang 生成IRの結合テストも `pnpm test` に含まれるため、通常は `devbox run -- pnpm test` で確認します。
devbox外で clang または llvm-as が見つからない場合、この結合テストだけはスキップされます。

## 動作確認

VSCode でこのリポジトリを開き、`F5` で Extension Development Host を起動します。
起動後のウィンドウで [packages/vscode-extension/examples/hello.ll](../packages/vscode-extension/examples/hello.ll) を開くと、シンタックスハイライトと LSP 機能を確認できます。

`.vsix` を作る場合は次のコマンドを使います。

```sh
pnpm --filter llvm-analyzer-vscode package
```

生成物は `packages/vscode-extension/llvm-analyzer-vscode.vsix` です。

## コマンド

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

## CI とサプライチェーン対策

| 対象                | 対策                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| 依存解決            | CI とローカル導入で `--frozen-lockfile` を使う。                                           |
| 公開直後の依存      | pnpm の `minimumReleaseAge` で、公開直後の依存バージョンをすぐ取り込まない。               |
| 依存の build script | pnpm の `allowBuilds` で、許可した依存だけにビルドスクリプト実行を認める。                 |
| GitHub Actions      | [pinact](https://github.com/suzuki-shunsuke/pinact) で `uses:` をコミット SHA に固定する。 |
| CI 検査             | Devbox 上で lint、format、typecheck、test、build、`pinact run --check` を実行する。        |

## リリース管理

リリース管理は Changesets で行います。
利用者へ届く変更を入れる PR では、次のコマンドで `llvm-analyzer-vscode` 向けの changeset を追加します。

```sh
pnpm changeset
```

リリース不要の変更では empty changeset を追加します。

```sh
pnpm changeset --empty
```

`main` へ changeset が入ると [`.github/workflows/release.yml`](../.github/workflows/release.yml) が Version PR を作ります。
Version PR を merge すると、同じ workflow が VSIX を作成し、Marketplace publish と GitHub Release 作成を行います。
empty changeset だけの Version PR など、`packages/vscode-extension/package.json` の version が変わらない merge では publish しません。

Version PR の作成には、GitHub repository settings の Actions 設定で「Allow GitHub Actions to create and approve pull requests」を有効にします。
この設定を無効にすると、`changesets/action` が Pull Request API で拒否され、Release workflow の `Create Version PR` job が失敗します。

## VSCode Marketplace への公開

Marketplace 公開の手動実行は [`.github/workflows/publish-vscode.yml`](../.github/workflows/publish-vscode.yml) で行います。
長期 PAT は使わず、GitHub Actions の OIDC token を Microsoft Entra の federated credential と交換し、`vsce publish --azure-credential` で公開します。

公開ワークフローは次の方針です。

| 項目         | 方針                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| 実行条件     | Version PR merge 後の `main` push、手動実行、または prerelease ではない GitHub Release の公開                    |
| 権限         | 既定は `contents: read`。Marketplace 公開 job だけ `id-token: write` を付与                                      |
| 環境         | `vscode-marketplace` environment を使い、必要なら reviewer / protected branch を設定する                         |
| 認証         | `secrets.AZURE_CLIENT_ID` と `secrets.AZURE_TENANT_ID` で Entra identity を指定する                              |
| パッケージ   | 権限なしの job で VSIX を作成し、checksum を記録して artifact 化する                                             |
| 公開         | 公開 job では artifact の checksum を検証し、依存 install は `--ignore-scripts` で lifecycle script を実行しない |
| Actions 固定 | 外部 GitHub Actions は full-length commit SHA で固定する                                                         |

Entra 側の federated credential は GitHub environment に紐づけます。
このリポジトリでは subject を次の形に固定する想定です。

```text
repo:r4ai/llvm-analyzer:environment:vscode-marketplace
```

Marketplace 側では、同じ identity が `r4ai` publisher の拡張機能を公開できるように設定します。
GitHub `vscode-marketplace` environment secrets には次を設定します。

| 変数              | 内容                                            |
| ----------------- | ----------------------------------------------- |
| `AZURE_CLIENT_ID` | Entra application または managed identity の ID |
| `AZURE_TENANT_ID` | Entra tenant ID                                 |

## 関連ドキュメント

| 文書                                                                          | 内容                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| [docs/design.md](design.md)                                                   | アーキテクチャ、パッケージ責務、LSP 機能の対応関係。 |
| [docs/roadmap.md](roadmap.md)                                                 | 実装済みフェーズと残タスクの管理。                   |
| [docs/plans/](plans/)                                                         | 各フェーズの実行ログ。ファイル名は古い順の連番。     |
| [packages/vscode-extension/README.md](../packages/vscode-extension/README.md) | VSCode 拡張機能としての機能と設定。                  |
