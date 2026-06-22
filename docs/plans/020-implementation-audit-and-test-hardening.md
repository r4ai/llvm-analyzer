# 実装監査とテスト補強

## Context

現状の品質ゲートは `pnpm test:coverage`、`pnpm typecheck`、`pnpm lint`、`pnpm format` が通っている。

一方で、coverage では `verifier.ts`、LSP features、analyzer の分岐に未検証箇所が残っている。

実装を読むと、LLVM IR の曖昧な `%` 識別子、命令フラグ付きの型推定、LSP のゼロ幅 range、hover 表示で欠陥につながる候補が見つかった。

今回の作業では、再現テストで欠陥を固定してから最小修正する。

## スコープ

- `%T` のような名前付き型とローカル値の解決を、型位置と値位置で分ける。
- `add nsw`、`load volatile`、`call fastcc` など、命令フラグや呼出規約を含む結果型推定を補強する。
- vector `icmp` / `fcmp` の結果型を lane 数に合わせて推定する。
- ユーザー定義関数の hover に opcode documentation を混ぜない。
- Code Action の request range がゼロ幅でも、診断 range の先頭や内部なら quick fix を返す。
- 外部 verifier runner の実プロセス分岐と LSP index の境界テストを補強する。

## やらないこと

- LLVM verifier 相当の完全な型検査は実装しない。
- 全 opcode の厳密な結果型推定は今回の範囲に含めない。
- VSCode extension host の E2E を増やす変更は、今回の修正が extension 固有 UI に波及しない限り行わない。

## 検証方法

- 欠陥候補ごとに先に失敗するテストを追加する。
- `pnpm test:coverage` でテストとカバレッジを確認する。
- `pnpm typecheck` で TypeScript の型検査を通す。
- `pnpm lint` で lint を通す。
- `pnpm format` でフォーマットを確認する。
