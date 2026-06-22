# 2026-06-22 実装ログ: Call Hierarchy

## Context

次期利便性・解析機能計画のフェーズ5として、LLVM IR の直接呼び出し関係を LSP Call Hierarchy で辿れるようにする。
Workspace Symbols でファイル横断のトップレベル関数索引が入ったため、同じ `.ll` ファイル単位の解析結果を使って callers / callees を返す。

## スコープ

やったこと:

- analyzer に `directCalls()` を追加し、`call` / `invoke` / `callbr` の直接 `@callee` を抽出するようにした。
- `CallHierarchyIndex` を追加し、複数ファイルをまたぐ incoming / outgoing calls を返すようにした。
- language-server の call hierarchy capability / prepare / incoming / outgoing handler を追加した。
- Workspace Symbols と同じファイル更新経路で call hierarchy 索引も更新するようにした。

やらなかったこと:

- 関数ポインタや `bitcast` 経由の間接呼び出し解決。
- インラインアセンブリ中の呼び出し解釈。
- overload や linkage を考慮した厳密なクロスファイル解決。

## 状態遷移表

| 入力状態                | 操作                   | 期待結果                                   |
| ----------------------- | ---------------------- | ------------------------------------------ |
| 関数定義上の位置        | prepare                | `CallHierarchyItem` を返す                 |
| `call void @callee()`   | directCalls / outgoing | caller から callee への呼び出しを返す      |
| `invoke void @callee()` | directCalls / outgoing | caller から callee への呼び出しを返す      |
| `callbr void @callee()` | directCalls / outgoing | caller から callee への呼び出しを返す      |
| `call void %fp()`       | directCalls            | 間接呼び出しとして無視する                 |
| ファイル更新            | upsert                 | 古い呼び出し関係を破棄して新しい関係を返す |
| ファイル削除            | delete                 | そのファイルの item / calls を返さない     |

## 検証方法

- Red: analyzer test に `directCalls()` 期待を追加し、未実装で失敗することを確認した。
- Red: `packages/language-server/src/lsp/call-hierarchy.test.ts` を追加し、未実装の `call-hierarchy.ts` 参照で失敗することを確認した。
- Green: analyzer の直接呼び出し抽出、`CallHierarchyIndex`、server handler を実装した。
- 追加確認:
  - `pnpm test -- packages/language-server/src/lsp/call-hierarchy.test.ts packages/analyzer/src/semantic/analyzer.test.ts`
  - `pnpm test:coverage`
  - `pnpm typecheck`
- coverage 確認: 全体 Lines 80.45%、`packages/language-server/src/lsp/call-hierarchy.ts` Lines 96.15% / Branch 75.75% / Functions 100%。
- レビュー対応: `call void %fp(ptr @global)` や `bitcast (ptr @callee to ptr)()` に含まれる `@name` を direct call として誤抽出しないよう、`@callee(` の構文だけを直接呼び出しとして扱うようにした。同一 caller/callee の複数 call site は LSP の期待どおり 1 item にまとめ、`fromRanges` に複数 range を入れるようにした。

## レビュー観点

- 間接呼び出しを direct call として誤抽出しないこと。
- incoming / outgoing が複数ファイルの直接呼び出しに対応していること。
- ファイル更新・削除で古い呼び出し関係が残らないこと。
