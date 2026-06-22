# 2026-06-22 プラン: parser lexer

> 実行プランのログ。過去のプランは書き換えず、ここに追記している。

## Context

[roadmap.md](../roadmap.md) のフェーズ「parser: lexer」を実装する。
解析の知能の土台となる純粋ドメイン層 `packages/parser` を新設し、その最初の構成要素である
**lexer（トークナイザ）** を古典派TDD（探索 → Red → Green → Refactor）で実装する。
lexer は LLVM IR ソース文字列を、`range`（offset/line/column）付きのトークン列へ分解する。
将来の再帰下降パーサ・analyzer・LSP（semanticTokens 等）の入力となる。

対象は最新安定 LLVM IR（opaque pointer `ptr` 前提）。`vscode`/LSP には一切依存しない純粋関数として実装し、
環境非依存で網羅的にユニットテストできる状態を保つ。

## スコープ

### やること

- `packages/parser` の足場（`package.json` / `tsconfig.json` / 公開API `src/index.ts`）。
- ルートに vitest のカバレッジ設定（`@vitest/coverage-v8`）。`pnpm test:coverage` を追加。
- lexer 本体 `tokenize(source: string): Token[]`（純粋関数、末尾に `Eof` を付与）。
  - トークン種別（バーワードは lexer で種別まで分類する方針）:
    - 識別子: `GlobalIdentifier` `@`、`LocalIdentifier` `%`、`MetadataIdentifier` `!`、
      `AttributeGroup` `#`、`ComdatIdentifier` `$`（いずれも名前/数値/`"..."` 形式に対応）。
    - `Label`（`name:` のラベル定義名。`add:` のようにキーワードと同名でもラベルとして扱う）。
    - バーワード分類: `Keyword`（構造キーワード+修飾子+呼出規約+フラグ+比較述語）/
      `Opcode`（命令）/ `Type`（`void`/`ptr`/... と `i<N>`）/ `Constant`（`true`/`null`/...）/
      未分類は `Identifier`。
    - `Number`（整数・浮動小数・`0x` 16進/特殊float）、`String`（`"..."`）、
      `Comment`（`;` から行末）、`Punctuation`（`= , { } ( ) [ ] < > * : ! # $ @ %` 等の記号）。
    - エラー回復用に `Unknown`（認識不能文字）、終端に `Eof`。
  - 各トークンは `value`（ソース上の生テキスト）と `range`（start/end の offset/line/column）を持つ。
    不変条件: `source.slice(range.start.offset, range.end.offset) === token.value`。
  - 行/列は LSP の `Position` に合わせ **0始まり**。offset も 0 始まり。

### やらないこと（このフェーズ外）

- AST 構築・構文解析（次フェーズ「parser: AST + 再帰下降パーサ」）。
- 構文診断の収集（lexer は不正文字を `Unknown` トークンとして残すのみ）。
- 数値ラベル `5:` のラベル化（`Number` + `:` として出力し、後段で解釈）。
- `%foo` の「型 vs 値」曖昧性の解決（出現位置依存。parser/analyzer の責務）。

## 検証方法

- 状態遷移表（文字クラス → 状態）から網羅的にテストケースを設計し、Red を確認してから実装。
- `pnpm test`（vitest）/ `pnpm typecheck` / `pnpm lint` / `pnpm format` が全てグリーン。
- `pnpm test:coverage` でカバレッジを取得（lexer を厚く）。
- `examples/hello.ll` 相当のスニペットを字句解析し、`slice === value` 不変条件を全トークンで検証。
