# llvm-analyzer

LLVM IR (`.ll`) 用の LSP です。

| 定義ジャンプ・表示                                                                             | ドキュメントの表示                                                                       |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ![definition](https://github.com/user-attachments/assets/c1944acd-5c12-4f19-9bec-662f896e1c97) | ![docs](https://github.com/user-attachments/assets/a8db7919-ca9d-47d1-8465-41a8719c7050) |

## 機能

| 分類         | 機能                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| 表示         | シンタックスハイライト、Semantic Tokens、Folding Range                                                 |
| 読解         | 宣言形 hover、opcode、type、attribute hover、定義ジャンプ、参照検索、Document Symbol、Workspace Symbol |
| 編集         | 補完、Rename、Format、Range Format                                                                     |
| 診断         | parser 診断、analyzer 診断、外部 LLVM verifier 診断                                                    |
| 補助表示     | SSA 値の推定型を表示する Inlay Hints                                                                   |
| ファイル参照 | `source_filename` と `!DIFile` から実在ファイルを開く Document Link                                    |
| 呼び出し関係 | `call`、`invoke`、`callbr` の直接呼び出しを辿る Call Hierarchy                                         |
| 制御フロー   | 現在関数の Control Flow Graph を Mermaid として表示するコマンド                                        |
| Quick Fix    | 未定義の近いグローバル名やラベル名への置換、終端命令後の命令削除                                       |

## 対応範囲

`llvm-analyzer` は opaque pointer の `ptr` を標準として扱います。
古い typed pointer 記法も寛容にパースします。

型構文は scalar、pointer、vector、array、struct、function type、named type、opaque struct を扱います。
`ptrtoaddr`、byte type `bN`、debug record、comdat、use-list order、`ptr addrspace(N)` 引数も解析対象です。

診断は編集時に効く軽量な構造解析と名前解決に絞っています。
未定義参照、重複定義、同一命令内の自己参照、終端命令後の通常命令などは検出します。
target datalayout に依存する型検査や LLVM verifier 相当の完全な検証は扱いません。

## LLVM verifier 連携

外部 verifier 診断は、PATH 上の `llvm-as` を使います。
既定のコマンドは次の形です。

```sh
llvm-as -o {devNull} -
```

`llvm-as` がない環境では、外部 verifier 診断だけを出しません。
parser 診断と analyzer 診断はそのまま使えます。

`llvm-analyzer.verifier.command` と `llvm-analyzer.verifier.args` を変更すると、`opt -passes=verify -disable-output -` などの verifier コマンドに差し替えられます。

## 設定

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

## ライセンス

このリポジトリは [MIT License](LICENSE) で公開しています。

開発者向けの情報は [docs/development.md](docs/development.md) にあります。
