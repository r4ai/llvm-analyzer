# llvm-analyzer-vscode

## 0.1.4

### Patch Changes

- 080aa27: Fix aggregate return type parsing and quoted multiline type reference resolution.
- 0f67ccb: Fix clang-generated LLVM IR handling for debug metadata, multiline EH instructions, named struct GEP operands, and attribute type arguments. Also require VS Code Workspace Trust for external verifier settings and restrict document links to in-workspace files.
- a9b9595: Show README screenshots on the VSCode Marketplace by using committed image assets with stable raw GitHub URLs.
- 8d64ad0: Fix multiline vector constants being split into separate parser entries and normalize rename input that uses the wrong identifier sigil.

## 0.1.3

### Patch Changes

- 474f15e: Use externally hosted README screenshots so they render on the VSCode Marketplace.
- dbd161e: Translate README to English; Japanese version preserved as README-ja.md.

## 0.1.2

### Patch Changes

- Use the root README as the VSCode Marketplace README.

## 0.1.1

### Patch Changes

- Rename the Marketplace display name to `LLVM IR Analyzer` to avoid a duplicate extension listing name.

## 0.1.0

### Minor Changes

- Initial VSCode Marketplace release.

  Includes LLVM IR syntax highlighting, bundled language server features, diagnostics, formatting, hover docs, document links, call hierarchy, inlay hints, quick fixes, and control-flow graph output.
