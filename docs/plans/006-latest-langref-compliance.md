# プラン: 最新 LangRef 準拠差分の修正

## Context

現在の parser / analyzer / TextMate 文法は、LSP 機能に必要な構造を粗く拾う実装として成立している。
一方で、最新の LLVM Language Reference Manual 23.0.0git と照合すると、合法な LLVM IR を取りこぼす箇所がある。
特に `ptrtoaddr`、byte type `bN`、debug record、comdat 定義、use-list order、`module asm`、複数行グローバル初期化子、数値ラベルは、現状の実装で誤分類・誤診断につながる。

この変更では、完全な LLVM verifier を実装するのではなく、既存設計の「構造重視・命令は粗く」を維持したまま、最新 LangRef 上の合法 IR を LSP 解析で壊さない範囲まで修正する。

## スコープ

やること:

- lexer の最新構文対応を増やす。
  - `ptrtoaddr` opcode。
  - byte type `bN`。
  - `/* ... */` ブロックコメント。
  - `s0x...` / `u0x...` 整数、`+inf` / `+qnan` などの浮動小数リテラル。
  - 数値ラベル `0:`。
  - debug record の `#dbg_*`。
- parser のトップレベル構造を拡張する。
  - `$foo = comdat any`。
  - `module asm "..."`。
  - `uselistorder` / `uselistorder_bb`。
  - 括弧・角括弧・中括弧にまたがる複数行トップレベルエントリ。
- debug record を命令ではない関数本体要素として保持する。
- analyzer の名前解決を改善する。
  - `%` が型参照として現れる位置を parameter / local と誤登録しない。
  - 基本的な well-formedness 診断として、命令結果の同一行自己参照とブロック終端後の命令を検出する。
- TextMate 文法・補完・ドキュメント辞書を lexer と同期する。
- design / roadmap / README の関連記述を更新する。
- Conventional Commit でコミットする。

やらないこと:

- LLVM verifier 全体の再実装。
- 命令ごとの完全な AST 型・型検査。
- dominance / CFG / memory model / attributes の完全検証。
- bitcode や target 固有拡張の網羅。

## 検証方法

- バグ修正として、先に再現テストを追加し Red を確認する。
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`
- 必要に応じて `pnpm test:coverage`
