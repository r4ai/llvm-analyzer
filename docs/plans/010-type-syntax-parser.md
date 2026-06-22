# 実装ログ: 型構文パーサ

## Context

次期利便性・解析機能計画のフェーズ1として、LLVM IR 型構文を純粋ドメイン層で扱えるようにする。
既存 analyzer は `i32` や `ptr` などの単純な型を正規表現で拾っていたため、vector / array / struct / function type / typed pointer の表示品質が限定的だった。
Inlay Hints や将来の診断・Quick Fix の土台として、型構文を AST 化して再利用できる形にする。

## スコープ

やったこと:

- `packages/parser/src/type/` に `parseLlvmType` と `formatLlvmType` を追加した。
- scalar / pointer / vector / array / struct / function type / named type / opaque struct を型 AST として表現した。
- `ptr addrspace(N)`、typed pointer、可変長引数、packed struct を扱えるようにした。
- analyzer の関数引数・命令結果の軽量型推定を、正規表現だけでなく型 AST ベースの抽出へ置き換えた。
- 複合型の推定結果が hover / completion の `type` 表示へ流れるようにした。

やらなかったこと:

- 全命令の厳密な型検査。
- target datalayout に依存するサイズ計算。
- LLVM verifier 相当の型整合性検証。

## 状態遷移表

| 状態 | 入力                                 | 遷移                   | 検証      |
| ---- | ------------------------------------ | ---------------------- | --------- |
| 開始 | `void` / `i32` / `double` / `%T`     | scalar / named type    | unit test |
| 開始 | `ptr`                                | opaque pointer         | unit test |
| 型後 | `addrspace(N)` + `*`                 | typed pointer          | unit test |
| 開始 | `<N x T>` / `<vscale x N x T>`       | vector type            | unit test |
| 開始 | `[N x T]`                            | array type             | unit test |
| 開始 | `{ ... }` / `<{ ... }>`              | struct / packed struct | unit test |
| 型後 | `(T, ...)`                           | function type          | unit test |
| 不正 | 空入力 / 区切り不足 / 余分なトークン | 診断を返して停止       | unit test |

## 検証方法

- Red: `packages/parser/src/type/type-parser.test.ts` を追加し、未実装の `type-parser.ts` 参照で失敗することを確認した。
- Green: 型 AST / パーサ / formatter を実装し、parser と analyzer の対象テストを通した。
- 追加確認:
  - `pnpm test -- packages/parser/src/type/type-parser.test.ts packages/analyzer/src/semantic/analyzer.test.ts`
  - `pnpm test:coverage`
  - `pnpm typecheck`
- coverage 確認: 全体 Lines 84%、`parser/src/type/type-parser.ts` Lines 94.3% / Branch 90.67%、`analyzer.ts` Lines 95.14%。
- レビュー対応: サブエージェントレビューで指摘された inline struct / packed struct を含む関数シグネチャの誤分割を再現テスト化し、`collectFunction` と analyzer の引数セグメント分割を型構文のネストに対応させた。

## レビュー観点

- 型パーサが parser の純粋層に閉じていること。
- analyzer が LSP / VSCode に依存せず、型 AST の文字列表現だけを受け取ること。
- 複合型を扱うテストが正常系・異常系の両方を含むこと。
