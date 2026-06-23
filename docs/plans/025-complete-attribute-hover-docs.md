# 実装ログ: Complete Attribute Hover Docs

## Context

前回の Attribute Hover Docs は代表的な属性だけを対象にした。
しかし利用者が求めているのは、LLVM LangRef に載る属性語を opcode と同じように hover で確認できる状態である。
属性は関数・戻り値・引数・グローバル変数・call site の契約を表すため、未対応語が残ると読解支援として不十分である。

## スコープ

- 公式 LangRef の Parameter Attributes、Function Attributes、Global Attributes に載る bareword 属性を `attributeDocs` に追加する。
- `memory(...)` の location / access kind や `captures(...)` の component など、lexer が属性構文内で keyword として扱う補助語にも hover docs を追加する。
- quoted string 属性は lexer 上で string token になるため、今回の bareword hover docs の対象外にする。
- 属性の verifier 相当の適用可否検証は扱わない。

## 検証方法

- `attributeDocs` が lexer の属性系 keyword を網羅するテストを追加する。
- 代表的な新規属性について、説明・サンプル・公式 LangRef リンクをテストで固定する。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format` を実行する。
