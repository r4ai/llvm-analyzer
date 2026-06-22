# LLVM IR

LLVM IR (`.ll`) 向けの VSCode 拡張機能。

## 機能

- TextMate 文法によるシンタックスハイライト。
- Language Server による hover / definition / references / documentSymbol / documentLink / semanticTokens / diagnostics / completion / rename / foldingRange / formatting。
- scalar / pointer / vector / array / struct / function type / named type / opaque struct の軽量型解析に基づく型表示。
- PATH 上の `llvm-as` を使った任意の外部 verifier 診断。
- parser / analyzer / external verifier ごとの診断有効化と重大度設定。
- SSA 値の推定型を表示する Inlay Hints。
- ワークスペース内の `.ll` ファイルを対象にした Workspace Symbols。
- `call` / `invoke` / `callbr` の直接呼び出しを辿る Call Hierarchy。
- `source_filename` と `!DIFile` の実在ファイルを開く Document Link。
- 行頭・行末空白と関数内インデントを安定化する Format / Range Format。
- 現在関数の Control Flow Graph を Mermaid として表示する command。
- 未定義の近いグローバル・ラベル名への置換や終端命令後の命令削除を提示する Quick Fix。

## 設定

- `llvm-analyzer.verifier.enabled`: 外部 verifier 診断を有効にする。
- `llvm-analyzer.verifier.command`: 実行するコマンド。既定は `llvm-as`。
- `llvm-analyzer.verifier.args`: コマンド引数。`{devNull}` は OS の null device に置換される。
- `llvm-analyzer.verifier.debounceMs`: 編集停止後に verifier を起動するまでの待ち時間。
- `llvm-analyzer.verifier.timeoutMs`: verifier の timeout。
- `llvm-analyzer.verifier.maxFileBytes`: 自動 verifier を実行する最大ファイルサイズ。
- `llvm-analyzer.diagnostics.parser.enabled`: parser 由来の構文診断を有効にする。
- `llvm-analyzer.diagnostics.parser.severity`: parser 由来の構文診断の重大度。
- `llvm-analyzer.diagnostics.analyzer.enabled`: analyzer 由来の意味診断を有効にする。
- `llvm-analyzer.diagnostics.analyzer.severity`: analyzer 由来の意味診断の重大度。
- `llvm-analyzer.diagnostics.verifier.enabled`: external verifier 由来の診断を有効にする。
- `llvm-analyzer.diagnostics.verifier.severity`: external verifier 由来の診断の重大度。
- `llvm-analyzer.inlayHints.types.enabled`: SSA 値の推定型 inlay hint を有効にする。

## 開発

`test:e2e` は VSCode Extension Host で fixture workspace を開き、主要 LSP 経路を VSCode command 経由で確認します。

```sh
pnpm --filter llvm-analyzer-vscode build
pnpm --filter llvm-analyzer-vscode test:e2e
pnpm --filter llvm-analyzer-vscode package
```
