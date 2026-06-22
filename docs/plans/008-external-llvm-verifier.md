# プラン: 外部 LLVM verifier 連携

## Context

LLVM verifier 全体を自前実装すると、LangRef 追従・型検査・CFG・属性・metadata の保守コストが高すぎる。
一方で LSP の診断としては、LLVM 本体の `llvm-as` / `opt -passes=verify` 相当を補助的に使うと、軽量 analyzer では拾えない verifier 診断を実用的に表示できる。

LSP の応答性を守るため、外部 verifier は主ループへ同期的に入れない。
即時診断は既存 parser/analyzer が担当し、外部 verifier は編集停止後にバックグラウンドで走らせ、古い結果を破棄する。

## Context compact 用メモ

- 現行構成は `vscode-extension -> language-server -> analyzer -> parser`。
- parser/analyzer は純粋層なので外部プロセス呼び出しを入れない。
- `packages/language-server/src/server.ts` が `scheduleAnalysis` で debounce し、`getDiagnostics(snapshot)` を publish している。
- 追加する外部 verifier は language-server 側の副作用として隔離する。

## スコープ

やること:

- language-server に外部 LLVM verifier 実行モジュールを追加する。
  - 既定は `llvm-as -o <devNull> -`。
  - stdin に現在の `.ll` テキストを渡す。
  - stderr の `:<line>:<column>:` 形式を LSP Diagnostic に変換する。
  - command missing / timeout / file size 超過では通常の LSP 体験を壊さない。
- server の診断フローを二段階にする。
  - 変更後すぐに既存 parser/analyzer 診断を publish。
  - 追加 debounce 後に verifier 診断を上乗せ publish。
  - 新しい編集が来たら古い verifier 結果を破棄し、実行中プロセスを abort する。
- VSCode settings を追加する。
  - enabled / command / args / debounceMs / timeoutMs / maxFileBytes。
- テストは fake runner で Red → Green にする。
- design / roadmap / README を更新する。
- Conventional Commits でコミットする。

やらないこと:

- LLVM verifier の自前実装。
- Wasm 版 LLVM の同梱。
- stderr の全フォーマット完全対応。
- workspace 全体や include path を伴う高度な検証。

## 検証方法

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`
- `pnpm test:coverage`
