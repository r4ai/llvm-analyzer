---
"llvm-analyzer-vscode": patch
---

巨大なLLVM IRの初回読み込みと関数内編集で、画面外のSSA値に対する表示用型推論を先送りするようにしました。
Lexerの位置計算も一回の前方向走査へ変更し、Inlay Hintsは要求範囲の型だけを推定します。
