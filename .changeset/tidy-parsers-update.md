---
"llvm-analyzer-vscode": patch
---

LSPの編集範囲を直接受け取る不変parser sessionを追加し、巨大なLLVM IRの局所更新で全文差分走査を避けるようにしました。
横に広い命令のエラー回復も、入力長に対して線形時間で処理します。
