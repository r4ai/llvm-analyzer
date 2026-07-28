---
"llvm-analyzer-vscode": patch
---

巨大なLLVM IRで、ファイルを開いた直後の定義・参照ジャンプを先行解析し、無関係な派生索引と診断debounceの待ち時間を除く。
parser専用の軽量Tokenと短い意味シンボルIDにより、初回Definitionの一時割り当てとGC時間も削減する。
