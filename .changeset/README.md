# Changesets

This directory contains changesets that record changes to be included in a release.

Normal usage:

```sh
pnpm changeset
```

For changes that do not need a release, create an empty changeset:

```sh
pnpm changeset --empty
```

The package published to the Marketplace from this repository is `llvm-analyzer-vscode`.
If changes to parser / analyzer / language-server are delivered to users as a VSCode extension, include `llvm-analyzer-vscode` in the changeset.
Internal packages can also have versions and changelogs, but the publish decision and GitHub Release tag are determined solely by the `llvm-analyzer-vscode` version.
