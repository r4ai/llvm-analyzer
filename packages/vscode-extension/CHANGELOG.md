# llvm-analyzer-vscode

## 0.1.5

### Patch Changes

- 66ddb5d: 解析途中の文字列、typed pointer、配列要素型、未知命令を含む LLVM IR の回復動作を修正し、全実装分岐の回帰テストを追加する。
- 6d767ef: 巨大な LLVM IR の初回読み込みと関数内編集で、画面外の SSA 値に対する表示用型推論を先送りするようにしました。
  Lexer の位置計算も一回の前方向走査へ変更し、Inlay Hints は要求範囲の型だけを推定します。
- 6f89f75: 巨大な LLVM IR で、意味解析と Document Link の処理時間が入力件数に対して二次的に増加する問題を修正しました。
  初回読み込みと差分編集後の再解析について、継続的な性能回帰検査も追加しました。
- 71a4780: 巨大な LLVM IR の関数内編集では、変更されたトップレベル要素だけを再パースするようにしました。
  初回読み込みでは診断、Workspace Symbols、Call Hierarchy が解析済みスナップショットを共有し、同じファイルの重複解析を避けます。
- 6d767ef: LSP の編集範囲を直接受け取る不変 parser session を追加し、巨大な LLVM IR の局所更新で全文差分走査を避けるようにしました。
  横に広い命令のエラー回復も、入力長に対して線形時間で処理します。

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
