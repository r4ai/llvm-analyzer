# 実装ログ: Code Action / Quick Fix

## Context

既存の parser / analyzer 診断には stable code が付いているため、意味を推測しすぎない範囲で Quick Fix を返せる。
このフェーズでは危険な IR 生成を避け、置換または削除だけに絞る。

## スコープ

やったこと:

- language-server に `textDocument/codeAction` provider を追加した。
- `undefined-reference` から、未定義グローバル `@name` を近い既存グローバル・関数へ置換する Quick Fix を返すようにした。
- `undefined-reference` から、未定義ラベル `%name` を近い既存ラベルへ置換する Quick Fix を返すようにした。
- `instruction-after-terminator` から、終端命令後の通常命令行を削除する Quick Fix を返すようにした。
- README、VSCode extension README、設計、ロードマップを更新した。

やらなかったこと:

- 新しい命令や基本ブロックの生成。
- verifier 診断の内容推測に基づく自動修正。
- マルチファイル rename 相当の edit。

## テスト

- `packages/language-server/src/lsp/features.test.ts`
  - 未定義グローバルの近似名置換。
  - 未定義ラベルの近似名置換。
  - 終端命令後の命令行削除。
  - `codeActionProvider` capability。

## 検証

- `pnpm test -- packages/language-server/src/lsp/features.test.ts`
- `pnpm typecheck`

## レビュー

- 別コンテキストのサブエージェントでレビューした。
- `%` で始まる未定義ローカル値へラベル Quick Fix が出る指摘に対応し、`label %...` 文脈だけに限定した。
- ラベル候補が別関数から混ざる指摘に対応し、診断位置を含む関数のラベルだけを候補にした。
- no-op 置換、遠い名前、非重複 range では Quick Fix を返さないテストを追加した。
- 終端命令後削除の最終行 range をテストした。
- `codeActionProvider` の server 登録自体は、現状の `server.ts` がプロセス起動と密結合しているため coverage 未計測の残リスクとして扱う。capability 値と action 生成は `features.test.ts` で確認する。
