# 2026-06-22 実装ログ: Format / Range Format

## Context

LLVM IR を読む・修正する際に、行頭空白や関数本体のインデントだけでも安定していると差分とレビューが読みやすくなる。
このフェーズでは完全な pretty printer ではなく、意味を変えない line-based edit に限定する。

## スコープ

やったこと:

- parser に純粋関数 `formatLlvmIr(source)` を追加した。
- トップレベル行、ラベル行、閉じブレースを左詰めにした。
- 関数本体の命令・コメントを2スペース字下げにした。
- language-server に `textDocument/formatting` と `textDocument/rangeFormatting` を追加した。
- rangeFormatting は指定範囲と交差する行全体だけを置き換えるようにした。
- README、VSCode extension README、設計、ロードマップを更新した。

やらなかったこと:

- 命令内部の空白正規化。
- コメント再配置。
- 複数行定数や metadata の折り返し。
- AST からの完全 pretty printer。

## テスト

- `packages/parser/src/formatter/formatter.test.ts`
  - トップレベル・関数本体・ラベル・閉じブレースのインデント。
  - 整形後も `parseModule` の代表ノード構造が維持されること。
  - 空行とコメント行。
- `packages/language-server/src/lsp/features.test.ts`
  - ドキュメント全体 formatting edit。
  - 指定範囲だけを置き換える rangeFormatting edit。

## 検証

- `pnpm test -- packages/parser/src/formatter/formatter.test.ts packages/language-server/src/lsp/features.test.ts`
- `pnpm typecheck`

## レビュー

- 別コンテキストのサブエージェントでレビューした。
- `define void @f() { ; comment` のように関数開始行の `{` 後ろへコメントが続く場合に本体へ入れない指摘に対応した。
- `rangeFormatting` の境界ケースが薄い指摘に対応し、`end.character !== 0`、最終行までの範囲、空 range のテストを追加した。
- `documentFormattingProvider` / `documentRangeFormattingProvider` の server 登録自体は、現状の `server.ts` がプロセス起動と密結合しているため coverage 未計測の残リスクとして扱う。capability 値と edit 生成は `features.test.ts` で確認する。
