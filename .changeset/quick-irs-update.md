---
"llvm-analyzer-vscode": patch
---

巨大なLLVM IRの関数内編集では、変更されたトップレベル要素だけを再パースするようにしました。
初回読み込みでは診断、Workspace Symbols、Call Hierarchyが解析済みスナップショットを共有し、同じファイルの重複解析を避けます。
