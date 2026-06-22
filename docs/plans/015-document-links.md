# 実装ログ: Document Link

## Context

`source_filename` や debug metadata に含まれる元ソースファイルを、IR を読んでいる最中にすぐ開けるようにする。
ワークスペース横断の索引とは独立した、現在ドキュメント内のファイル参照だけを対象にする。

## スコープ

やったこと:

- analyzer に `collectFileReferenceCandidates` を追加し、`source_filename` と `!DIFile(filename:, directory:)` からファイル参照候補を抽出した。
- language-server に `textDocument/documentLink` provider を追加した。
- 相対パスは IR ファイルのディレクトリ、次に workspace folder から解決するようにした。
- 絶対パスはそのまま存在確認し、実在するローカルファイルだけを Document Link にした。
- README、VSCode extension README、設計、ロードマップを更新した。

やらなかったこと:

- 任意コメント内 URL の抽出。
- DWARF debug metadata の完全解釈。
- 存在しないファイルを設定でリンク化する挙動。

## テスト

- `packages/analyzer/src/semantic/file-references.test.ts`
  - `source_filename` の候補抽出。
  - `!DIFile` の `directory` / `filename` 結合。
- `packages/language-server/src/lsp/document-links.test.ts`
  - workspace 相対パスの解決。
  - 存在しない候補をリンク化しないこと。
  - debug metadata 由来の絶対パス候補。

## 検証

- `pnpm test -- packages/analyzer/src/semantic/file-references.test.ts packages/language-server/src/lsp/document-links.test.ts`
- `pnpm typecheck`

## レビュー

- 別コンテキストのサブエージェントでレビューした。
- `\HH` 形式の LLVM IR 文字列エスケープを復号していない指摘に対応し、`source_filename = "src\2Fmain.c"` のような候補を解決できるようにした。
- 既定の存在確認がディレクトリも通す指摘に対応し、`stat().isFile()` で実在ファイルだけをリンク化するようにした。
- `documentLinkProvider` の capability 宣言は単体テストで固定した。server の `onDocumentLinks` 登録自体は現状の `server.ts` がプロセス起動と密結合しているため、今回の coverage では未計測の残リスクとして扱う。
