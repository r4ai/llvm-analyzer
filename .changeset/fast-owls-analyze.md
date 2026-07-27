---
"llvm-analyzer-vscode": patch
---

巨大なLLVM IRで、意味解析とDocument Linkの処理時間が入力件数に対して二次的に増加する問題を修正しました。
初回読み込みと差分編集後の再解析について、継続的な性能回帰検査も追加しました。
