# 2026-06-22 実装ログ: Workspace Symbols

## Context

次期利便性・解析機能計画のフェーズ4として、単一ファイル内の document symbol だけでなく、ワークスペース内の `.ll` ファイルを横断してトップレベル定義を検索できるようにする。
IR 調査では関数・グローバル・名前付き型・メタデータをファイル横断で探す機会が多いため、language-server 側にファイル単位の解析結果を索引化する層を追加する。

## スコープ

やったこと:

- `WorkspaceSymbolIndex` を追加し、URI 単位で `DocumentSnapshot` を登録・置換・削除できるようにした。
- `@function`、`@global`、`%type`、`!metadata`、属性グループ、comdat を workspace symbol として返すようにした。
- query は大文字小文字を無視した部分一致にした。
- open document の解析時、workspace folder の初期走査、watched file の作成・変更・削除で索引を更新するようにした。
- `workspace/symbol` provider を server capability と handler に追加した。

やらなかったこと:

- クロスファイルの厳密なリンク解決。
- bitcode や object file の読み取り。
- `.ll` 以外のファイル形式の索引化。

## 状態遷移表

| 入力状態                         | 操作             | 期待結果                                         |
| -------------------------------- | ---------------- | ------------------------------------------------ |
| 新規 `.ll` ファイル              | upsert / created | トップレベル定義が検索可能になる                 |
| 既存 `.ll` ファイル              | upsert / changed | 古い定義が消え、新しい定義だけが検索可能になる   |
| `.ll` ファイル削除               | delete / deleted | その URI の定義が検索結果から消える              |
| query 空文字                     | search           | 索引済みトップレベル定義を全件返す               |
| query あり                       | search           | 大文字小文字を無視して部分一致した定義だけを返す |
| 関数内 parameter / local / label | search           | workspace symbol には含めない                    |

## 検証方法

- Red: `packages/language-server/src/lsp/workspace-symbols.test.ts` を追加し、未実装の `workspace-symbols.ts` 参照で失敗することを確認した。
- Green: `WorkspaceSymbolIndex` と server の `workspace/symbol` 接続を実装した。
- 追加確認:
  - `pnpm test -- packages/language-server/src/lsp/workspace-symbols.test.ts packages/language-server/src/lsp/features.test.ts`
  - `pnpm test:coverage`
  - `pnpm typecheck`
- coverage 確認: 全体 Lines 80.28%、`packages/language-server/src/lsp/workspace-symbols.ts` Lines 90.69% / Branch 80.95% / Functions 100%。
- レビュー対応: open document の未保存内容を disk snapshot より優先し、初期走査や watched file event が dirty buffer の索引を古いディスク内容で上書きしないようにした。`.ll` の close 時はディスク内容へ戻し、読めなければ索引を破棄する。workspace/symbol capability と VSCode `.ll` file watcher 同期もテストで固定した。

## レビュー観点

- 索引が URI 単位で置き換わり、変更・削除で古い symbol が残らないこと。
- language-server 側の workspace 走査が `.ll` に限定され、`node_modules` / `.git` などを避けること。
- workspace symbol に関数内の parameter / local / label を混ぜないこと。
