# 実装ログ: Attribute Hover Docs

## Context

opcode / type hover は LangRef の説明、LLVM IR 例、公式リンクを表示できる。
一方で、`nounwind`、`noundef`、`captures`、`memory` などの属性語は lexer で既知語として扱っているにもかかわらず、hover では説明が出ない。
LLVM IR を読むときは属性が関数や引数の契約を大きく変えるため、opcode と同じ粒度の短い説明と公式 LangRef への導線が必要である。

## スコープ

- `attributeDocs` を analyzer のドキュメント辞書として追加する。
- 関数属性、パラメータ属性、メモリ効果属性、浮動小数点環境属性の代表語に、短い説明、典型的な使い方、LLVM IR 例、公式 LangRef リンクを持たせる。
- LSP hover で opcode / type と同じ経路から属性 docs を返す。
- 今回は LLVM verifier 相当の属性妥当性検証や、全ターゲット固有属性の網羅説明は扱わない。

## 検証方法

- `packages/analyzer/src/semantic/analyzer.test.ts` で `attributeDocs` の本文、例、リンクを固定する。
- `packages/language-server/src/lsp/features.test.ts` で属性 token 上の hover が markdown と正しい range を返すことを確認する。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format` を実行する。
