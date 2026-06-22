# LLVM IR

LLVM IR (`.ll`) 向けの VSCode 拡張機能。

## 機能

- TextMate 文法によるシンタックスハイライト。
- Language Server による hover / definition / references / documentSymbol / semanticTokens / diagnostics / completion / rename / foldingRange。
- PATH 上の `llvm-as` を使った任意の外部 verifier 診断。

## 設定

- `llvm-analyzer.verifier.enabled`: 外部 verifier 診断を有効にする。
- `llvm-analyzer.verifier.command`: 実行するコマンド。既定は `llvm-as`。
- `llvm-analyzer.verifier.args`: コマンド引数。`{devNull}` は OS の null device に置換される。
- `llvm-analyzer.verifier.debounceMs`: 編集停止後に verifier を起動するまでの待ち時間。
- `llvm-analyzer.verifier.timeoutMs`: verifier の timeout。
- `llvm-analyzer.verifier.maxFileBytes`: 自動 verifier を実行する最大ファイルサイズ。

## 開発

```sh
pnpm --filter llvm-analyzer-vscode build
pnpm --filter llvm-analyzer-vscode test:e2e
pnpm --filter llvm-analyzer-vscode package
```
