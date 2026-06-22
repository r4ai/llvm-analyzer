# 実装ログ: LangRef 参照付き Hover Docs

## Context

opcode / type hover 辞書は短い英語文だけを返していた。
利用者が LLVM IR を読む場面では、命令の意味だけでなく、典型的な使い方と公式 LangRef への導線が必要になる。
ただし hover は長くしすぎると読解を妨げるため、説明は簡潔に保ち、詳細は公式リンクへ委ねる。

## スコープ

- 既存の opcode / type hover 辞書に、短い意味、使い方、LLVM IR 例、公式 LangRef リンクを含める。
- 公式 LangRef の該当セクションを根拠にしつつ、本文はエディタ向けに簡潔な英語へ要約する。
- analyzer の意味解析や型推定は変更しない。
- opcode / type の網羅拡張は別作業にし、既存辞書の品質改善に絞る。

## 検証方法

- `packages/analyzer/src/semantic/analyzer.test.ts` で Example と LangRef リンクを固定する。
- `packages/language-server/src/lsp/features.test.ts` で hover に Example と公式リンクが出ることを確認する。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format` を実行する。
