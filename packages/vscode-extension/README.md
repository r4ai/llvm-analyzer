# LLVM IR

LLVM IR (`.ll`) 向けの VSCode 拡張機能。

## 機能

- TextMate 文法によるシンタックスハイライト。
- Language Server による hover / definition / references / documentSymbol / semanticTokens / diagnostics / completion / rename / foldingRange。

## 開発

```sh
pnpm --filter llvm-analyzer-vscode build
pnpm --filter llvm-analyzer-vscode test:e2e
pnpm --filter llvm-analyzer-vscode package
```
