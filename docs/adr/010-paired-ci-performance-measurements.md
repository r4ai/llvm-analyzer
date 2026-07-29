# ADR 010: 同一runner内のペア性能計測

## Status

Accepted

## Date

2026-07-28

## Supersedes

[ADR 006](./006-batch-short-performance-measurements.md)

## Superseded by

なし

## Context

巨大IR性能ゲートは、GitHub-hosted runnerで5サンプルの中央値を計測している。
短時間処理は固定回数のバッチへまとめているが、サンプルの散らばりと判定の不確実性は記録していない。

同じソースツリーを17回計測した評価では、`shared-global-references`の正規化増加率の変動係数が18.9%、派生索引の削減時間が31.5%になり、1回だけ`--check`が失敗した。
同じソースツリーの初回snapshotはローカルで81.6 msから97.2 ms、GitHub Actionsで211.0 msとなり、絶対時間は実行環境に依存していた。

self-hosted runnerは運用対象にしない。
GitHub-hosted runner上で再現可能なuserlandと比較条件を作り、共有ホストの差を判定から除く必要がある。

## Decision Drivers

- self-hosted runnerを保守せず、GitHub-hosted runnerで実行する。
- Node、pnpm、LLVM、OS、CPU affinityを明示する。
- 共有ホストの速度差を、同じVM内のbaseと変更後の比較で相殺する。
- 数ms未満の処理を時計分解能より十分に長いバッチで計測する。
- 性能回帰と計測不能を別の状態として報告する。
- 生サンプルと実行環境を保存し、閾値を後から検証できるようにする。

## Considered Options

### 1. self-hosted runnerを運用する

専用の物理マシンまたは仮想マシンへGitHub Actions runnerを登録する。

得るもの:

- CPUモデル、負荷、電源設定を直接管理できる。
- 絶対時間の長期比較に適した環境を作れる。

失うもの:

- OS更新、runner更新、障害対応、セキュリティ境界の運用が必要になる。
- 現在のリポジトリ規模に対して保守コストが大きい。

### 2. 固定コンテナだけで計測する

GitHub-hosted runner上の固定digestコンテナでベンチマークを実行する。

得るもの:

- userlandとツールをイメージとして固定できる。

失うもの:

- コンテナは共有ホストのCPUスケジューリング、割り込み、周波数を固定しない。
- Devboxがすでにツールバージョンを固定しており、二重の環境管理になる。

### 3. Devboxと同一VM内のペア比較を使う

ベンチマークを専用jobへ分離し、Devboxでツールを固定する。
pull requestではbaseと変更後を同じVMへcheckoutし、実行順を交互にして比較する。
Linuxでは一つの論理CPUへaffinityを固定する。

得るもの:

- runner全体が速い場合と遅い場合の両方で、baseと変更後が同じ影響を受ける。
- 追加のrunner運用が不要になる。
- 現在のDevbox定義をuserlandの唯一の基準として維持できる。

失うもの:

- 同じVM内でも短時間の一時停止は残る。
- baseと変更後の依存関係を同じjob内に導入するため、CI時間が増える。
- 絶対時間を異なるrun間で厳密に比較する用途には向かない。

## Decision

GitHub-hosted `ubuntu-24.04`の専用benchmark jobで、Devboxと単一CPU affinityを使う。
pull requestではbaseと変更後を同じVMへcheckoutし、base先行と変更後先行を交互に計測する。

短時間処理は、一サンプルの計測時間が100 ms以上になるまで反復回数を自動調整する。
9サンプルから開始し、相対誤差が収束しない場合は奇数個ずつ最大25サンプルまで増やす。

代表値、MAD、95% bootstrap信頼区間、相対誤差、生サンプルを保存する。
上限に対する判定は、信頼区間全体が上限以下なら`pass`、全体が上限を超えれば`regression`、上限をまたげば`inconclusive`とする。
`inconclusive`は性能回帰として失敗させず、計測結果へ明示する。

入力4倍の正規化増加率とbase比を性能回帰の主指標にする。
絶対wall timeは利用者が待つ時間の粗い上限として残す。
プロセスCPU時間も記録し、wall timeだけが悪化した場合にrunner待機と処理量を切り分ける。

各runはJSON artifactとGitHub Actions Job Summaryへ保存する。
mainのpushと定期実行は履歴用の計測を行い、pull requestはbase比較を必須の性能ゲートとして実行する。

## Consequences

良い影響:

- 異なるGitHub-hosted runner間の速度差がpull request判定へ直接入らない。
- 一時停止を含むサンプルが、中央値だけで隠れず分散として観測できる。
- 0.1 msへ丸めた値で回帰判定する経路を除ける。
- 性能回帰、正常、計測不能を別々に報告できる。

悪い影響:

- pull requestごとにbaseの依存関係も導入するため、benchmark jobが長くなる。
- bootstrap信頼区間と逐次サンプリングの実装を保守する必要がある。
- `inconclusive`を放置すると性能契約が弱くなるため、定期計測で継続回数を監視する必要がある。

中立的な影響:

- 単一CPU affinityは並列処理性能を測らない。
  現在のparser、analyzer、LSP操作は同期CPU処理が中心なので、この制約を受け入れる。
- 絶対時間の厳密な長期SLOが必要になった場合は、larger runnerまたはself-hosted runnerを別のADRで評価する。

## Scope

`scripts/benchmark-large-ir.mjs`とGitHub Actions上の巨大IR性能ゲートへ適用する。
VSCode Extension HostのE2E待ち時間と外部LLVM verifierの実行時間には適用しない。

## Follow-up

- 安定計測helperへ自動バッチ、要約統計、信頼区間、三状態判定を追加する。
- baseと変更後を交互に実行する比較runnerを追加する。
- CIを通常検査と性能検査へ分離し、artifactとJob Summaryを保存する。
- 現在設計、開発手順、ロードマップへ反映する。

## References

- [プラン041](../plans/041-reliable-ci-performance-gates.md)
- [ADR 002](./002-avoid-quadratic-full-document-analysis.md)
- [設計](../design.md)
