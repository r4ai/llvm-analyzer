# プラン: clang生成IRの実践テストとセキュリティ硬化

## Context

clangが生成するLLVM IRは、手書きfixtureよりも属性、debug metadata、例外処理、数値SSA名、複数行命令を多く含む。
現状のテストは構文要素ごとの単体確認が厚い一方で、C/C++からIRを生成してLSP機能まで通す実践的な検証が不足している。

VSCode拡張は外部LLVM verifierを起動できる。
そのため、workspace設定から実行コマンドを変更できる点をWorkspace Trustの境界として明示する必要がある。

## スコープ

- 自前のC/C++テスト入力を一時ファイルとして作り、clangでLLVM IRへ変換する。
- 生成したIRをparser、analyzer、LSP adapterの主要経路へ通す。
- 例外処理、switch、debug record、metadata attachment、数値SSA名を含む実践的なIRを検証する。
- clangはdevbox管理の依存として追加する。
- VSCode manifestでWorkspace Trustの扱いを明示する。
- 外部OSSプログラムはリポジトリに取り込まない。

## やらないこと

- LLVM verifier全体を自前実装しない。
- 外部OSSコードや生成済みの大きなIRをfixtureとして保存しない。
- clangが存在しないdevbox外環境に、グローバルインストールを要求しない。

## 検証方法

- 先にmanifestのWorkspace Trustテストを追加し、失敗を確認する。
- clang生成IRテストを追加し、devbox環境でC/C++からIRを生成して解析する。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format` を実行する。
- 必要に応じて `pnpm test:coverage` で変更箇所の実行経路を確認する。
