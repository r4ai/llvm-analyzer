# CI性能ゲートの信頼性向上

## Context

巨大IR性能ゲートは、固定した5サンプルの中央値を静的な閾値と比較している。
短時間処理の一部だけがバッチ計測され、実行順、runner差、サンプルの散らばり、判定の不確実性は扱っていない。

同じソースツリーを反復した評価では、正規化増加率と削減時間に10%を超える変動があり、コード無変更でも`--check`が失敗した。
同じソースツリーでもローカルとGitHub Actionsの絶対時間は2倍以上異なった。

実行環境と統計判定の方針は[ADR 010](../adr/010-paired-ci-performance-measurements.md)に記録する。

## スコープ

今回やること:

- benchmark jobを通常検査から分離する。
- Devbox、Ubuntu、単一CPU affinityで計測条件を明示する。
- pull requestのbaseと変更後を同じVMへcheckoutし、実行順を交互にする。
- 短時間処理を100 ms以上の自動バッチへまとめる。
- 9サンプルから最大25サンプルまで逐次計測する。
- 代表値、MAD、95%信頼区間、相対誤差、生サンプルを出力する。
- `pass`、`regression`、`inconclusive`を分ける。
- 閾値判定に丸め前の値を使う。
- wall timeとプロセスCPU時間を記録する。
- JSON artifactとGitHub Actions Job Summaryを保存する。
- mainのpushと定期実行で傾向計測を継続する。
- 現行mainと変更後を同じ環境で比較し、安定度と検出力を評価する。

今回やらないこと:

- self-hosted runnerを導入する。
- GitHub larger runnerを必須にする。
- 性能回帰が出なくなるまで閾値を緩める。
- 失敗した計測を理由なしに再試行して成功扱いする。
- 外部LLVM verifierとVSCode Extension Hostの性能を同じゲートへ含める。

## 状態遷移とテスト義務

| 状態       | 入力                       | 次状態       | 検証する契約                               |
| ---------- | -------------------------- | ------------ | ------------------------------------------ |
| 未調整     | 短時間処理                 | 調整済み     | 一サンプルが目標時間以上になる反復数を選ぶ |
| 調整済み   | 安定した9サンプル          | 計測済み     | 9サンプルで終了する                        |
| 調整済み   | 誤差が大きい9サンプル      | 追加計測     | 奇数個を保ってサンプルを増やす             |
| 追加計測   | 最大25サンプル             | 計測済み     | 最大数を超えない                           |
| 計測済み   | 信頼区間全体が上限以下     | pass         | 正常と判定する                             |
| 計測済み   | 信頼区間全体が上限超過     | regression   | 回帰と判定する                             |
| 計測済み   | 信頼区間が上限をまたぐ     | inconclusive | 回帰と断定しない                           |
| 比較前     | base先行round              | 比較中       | 次roundは変更後を先行する                  |
| 比較中     | 変更後先行round            | 比較済み     | 順序差を両側へ配分する                     |
| 出力前     | 計測結果                   | 保存済み     | JSONとJob Summaryが同じ判定を示す          |
| 設定受付前 | 不正な反復数または信頼水準 | 失敗         | 補正せず例外として拒否する                 |

## 検証方法

- 安定計測helperの状態遷移をVitestでRed、Greenの順に確認する。
- 比較runnerの実行順、回帰、正常、判定不能、成果物出力を古典派テストで確認する。
- 意図的に遅い候補を与え、回帰を検出できることを確認する。
- 同じ実装をbaseと変更後に指定し、偽陽性が出ないことを反復確認する。
- `pnpm test:coverage`、`pnpm typecheck`、`pnpm lint`、`pnpm format`、`pnpm build`を実行する。
- `pnpm benchmark:large-ir -- --check`を複数回実行する。
- GitHub Actions上でbase比較、artifact、Job Summary、定期実行の配線を確認する。

## 実装結果

CIでは`ubuntu-24.04`、Devbox、固定ロケール、固定タイムゾーン、固定Node.jsヒープ、単一CPU affinityを使う専用benchmark jobへ分離した。
pull requestではbaseと変更後を同じVMへcheckoutし、同じ計測harnessで先行順を交互にしながら3 round比較する。
mainへのpush、手動実行、定期実行では同一ソースを3 round計測し、runner内の揺らぎを記録する。

計測helperには自動バッチ、逐次サンプリング、中央値、MAD、p90、決定的bootstrapによる95%信頼区間、相対誤差を実装した。
比較判定は相対悪化が10%を超え、かつ絶対悪化が5 msを超えた場合だけ`regression`とする。
信頼区間が閾値をまたぐ場合は`inconclusive`として成果物へ残すが、回帰とは断定しない。
各roundの生JSON Lines、集約JSON、Markdown summary、wall time、CPU時間、実行環境を30日間のartifactとして保存する。

古典派テストでは、調整、収束、最大サンプル到達、交互実行、正常、回帰、判定不能、不正入力を含む状態遷移を網羅した。
`pnpm test:coverage`は425テストが成功し、statement、branch、function、lineの全指標で100%だった。

同じソースをbaseと変更後へ指定した3 round評価では、確定回帰は0件だった。
揺らぎの大きい3指標は`inconclusive`となり、偽の回帰としてCIを停止しなかった。

`origin/main`の`6ab05c957a556db4f908737786f2a19e35875bf5`と変更後を同一環境、同一harnessで3 round比較した結果、確定回帰は0件だった。
suite wall timeの中央値は8596.8 msから8581.0 ms、比率は0.997、95%信頼区間は0.966から0.998だった。
suite CPU user timeの中央値は13643.8 msから13561.6 ms、比率は1.011、95%信頼区間は0.969から1.031だった。
LSP初回loadの中央値は84.8 msから78.8 ms、incremental editは24.9 msから25.2 msだった。
extra-large navigationは比率の95%信頼区間が0.982から1.143となったため、回帰ではなく`inconclusive`と判定した。

`pnpm lint`、`pnpm format`、`pnpm typecheck`、`pnpm test:coverage`、`pnpm build`、`pnpm benchmark:large-ir -- --check`、`pinact run`は成功した。
