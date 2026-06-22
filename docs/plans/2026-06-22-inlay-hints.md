# 2026-06-22 実装ログ: Inlay Hints

## Context

次期利便性・解析機能計画のフェーズ3として、SSA 値の推定型をエディタ上に直接表示する。
フェーズ1で型構文パーサを導入し、analyzer の `SemanticSymbol.type` が複合型にも対応し始めたため、まずは安全に推定済みの型だけを LSP Inlay Hint へ接続する。

## スコープ

やったこと:

- `textDocument/inlayHint` で SSA parameter / local の推定型を `: type` として返すようにした。
- 表示対象は analyzer が既に型を持つシンボルに限定した。
- `llvm-analyzer.inlayHints.types.enabled` で型 inlay hint を切り替えられるようにした。
- VSCode `contributes.configuration` に inlay hint 設定 schema を追加した。

やらなかったこと:

- 全命令の完全な型推論。
- predecessor 数など CFG 由来の補助情報。
- デバッグ情報由来の高級言語変数名表示。

## 状態遷移表

| 入力状態                     | 設定     | 出力                           |
| ---------------------------- | -------- | ------------------------------ |
| parameter/local に推定型あり | enabled  | 定義名の直後に `: type` を表示 |
| parameter/local に推定型なし | enabled  | hint を返さない                |
| parameter/local に推定型あり | disabled | hint を返さない                |
| global/type/metadata symbol  | enabled  | hint を返さない                |

## 検証方法

- Red: `packages/language-server/src/lsp/features.test.ts` に `getInlayHints` 期待を追加し、未実装で失敗することを確認した。
- Green: LSP adapter の `getInlayHints`、server capability / handler、VSCode schema を実装した。
- 追加確認:
  - `pnpm test -- packages/language-server/src/lsp/features.test.ts`
  - `pnpm test:coverage`
  - `pnpm typecheck`
- coverage 確認: 全体 Lines 83.13%、`packages/language-server/src/lsp/features.ts` Lines 94.3% / Branch 67.44% / Functions 100%。
- レビュー対応: `textDocument/inlayHint` の request range に沿って hint 表示位置をフィルタするようにした。設定変更時には language-server から inlay hint refresh を要求し、非対応クライアントでは次回要求時の再計算へフォールバックする。inlay hint 設定の正規化、provider capability、schema 既定値一致もテストで固定した。

## レビュー観点

- Inlay Hint が analyzer の既存型モデルだけを使い、parser / analyzer の純粋層へ LSP 依存を持ち込んでいないこと。
- hint の表示位置が定義名直後で、既存テキストを隠さないこと。
- 設定 schema と server 側の設定読み込みが一致していること。
