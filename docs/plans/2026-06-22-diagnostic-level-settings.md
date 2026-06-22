# 2026-06-22 実装ログ: 診断レベル設定

## Context

次期利便性・解析機能計画のフェーズ2として、parser / analyzer / external verifier の診断をソースごとに制御できるようにする。
生成途中の IR や独自方言を読む場合、構文診断や verifier 診断を一時的に抑制したい場面があるため、language-server のアダプタ層で有効化と重大度を調整する。

## スコープ

やったこと:

- `packages/language-server/src/lsp/diagnostics.ts` に診断設定の正規化と適用処理を追加した。
- `parser` / `analyzer` / `verifier` ごとに `enabled` と `severity` を設定できるようにした。
- `getDiagnostics` で parser / analyzer 診断へ設定を適用した。
- external verifier 診断にも同じ設定を適用し、verifier 診断が無効な場合は外部プロセスを起動しないようにした。
- VSCode `contributes.configuration` に `llvm-analyzer.diagnostics.*` の schema を追加した。

やらなかったこと:

- 診断メッセージの国際化。
- LLVM バージョン別の診断切り替え。
- 診断コードごとの細粒度な設定。

## 状態遷移表

| 入力状態          | 設定                            | 出力                                              |
| ----------------- | ------------------------------- | ------------------------------------------------- |
| parser 診断あり   | parser enabled                  | parser 診断を publish                             |
| parser 診断あり   | parser disabled                 | parser 診断を除外                                 |
| analyzer 診断あり | analyzer severity = information | analyzer 診断を Information として publish        |
| verifier 診断あり | verifier disabled               | verifier 診断を除外し、外部 verifier を起動しない |
| verifier 診断あり | verifier severity = hint        | verifier 診断を Hint として publish               |
| 不正な設定値      | 任意                            | 既定値へ正規化                                    |

## 検証方法

- Red: `packages/language-server/src/lsp/diagnostics.test.ts` を追加し、未実装の `diagnostics.ts` 参照で失敗することを確認した。
- Green: 診断設定の純粋関数、`getDiagnostics` 連携、server 設定読み込み、VSCode schema を実装した。
- 追加確認:
  - `pnpm test -- packages/language-server/src/lsp/diagnostics.test.ts packages/language-server/src/lsp/features.test.ts packages/language-server/src/lsp/verifier.test.ts`
  - `pnpm test:coverage`
  - `pnpm typecheck`
- coverage 確認: 全体 Lines 83.67%、`packages/language-server/src/lsp/diagnostics.ts` Lines 100% / Branch 95.45% / Functions 100%。
- レビュー対応: VSCode client の `synchronize.configurationSection` に `llvm-analyzer.verifier` と `llvm-analyzer.diagnostics` を追加し、設定変更が language-server へ通知されるようにした。verifier 起動判定と verifier 診断結合を純粋関数化し、verifier disabled 時の抑止と severity 再適用をテストした。VSCode configuration schema はキー存在だけでなく、`type` / `default` / `enum` が既定値と一致することを確認した。

## レビュー観点

- 診断設定の解釈が language-server 層に閉じ、parser / analyzer の純粋層へ漏れていないこと。
- external verifier disabled 時に余計な外部プロセスを起動しないこと。
- VSCode configuration schema と language-server の設定読み込みパスが一致していること。
