# Changesets

このディレクトリには、リリース対象の変更を記録する changeset を置きます。

通常の利用:

```sh
pnpm changeset
```

リリース不要の変更では empty changeset を作ります。

```sh
pnpm changeset --empty
```

このリポジトリで Marketplace に公開する対象は `llvm-analyzer-vscode` です。
parser / analyzer / language-server の変更が VSCode 拡張として利用者に届く場合は、changeset に `llvm-analyzer-vscode` を含めます。
内部 package も version / changelog は作れますが、公開判定と GitHub Release tag は `llvm-analyzer-vscode` の version だけを使います。
