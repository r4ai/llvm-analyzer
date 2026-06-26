# ADR 001: トレードオフを伴う判断をADRに記録する

## Status

Accepted

## Date

2026-06-26

## Supersedes

なし

## Superseded by

なし

## Context

このリポジトリには、実装ログとして `docs/plans/` がある。
また、現在有効な全体設計は `docs/design.md` にまとまっている。

しかし、トレードオフを伴う判断は、実装ログと現在設計のどちらにも収まりきらない。
`docs/plans/` だけに置くと、後から判断理由を探すときにフェーズ単位のログを読み直す必要がある。
`docs/design.md` だけに置くと、現在の結論は残るが、検討した代替案と失ったものが薄くなる。

今後は、判断の理由を後から参照できる場所を用意する。
同時に、Codex が同じ基準で ADR を作成できるように repo-local skill も用意する。

## Decision Drivers

- 判断理由と不採用案を長期的に参照できる。
- `docs/design.md` を現在設計の文書として保てる。
- `docs/plans/` を実装ログとして保てる。
- エージェントが迷わず同じ手順で ADR を作れる。
- 文書作成の負荷を増やしすぎない。

## Considered Options

### 1. `docs/adr/` と `adr-workflow` スキルを追加する

`docs/adr/` に連番 ADR を置き、`.agents/skills/adr-workflow` に作成手順を置く。

得るもの:

- 判断理由、不採用案、影響を `docs/plans/` から独立して追える。
- `docs/design.md` には現在設計だけを書ける。
- エージェントが ADR の要否、連番、関連文書更新を同じ手順で確認できる。

失うもの:

- 判断を伴う変更では、追加の文書作成コストが発生する。
- ADR と設計文書の重複を避ける運用が必要になる。

### 2. `docs/plans/` に判断理由も集約する

既存の実装ログへ判断理由と代替案も書く。

得るもの:

- 新しい文書種別を増やさずに済む。
- 実装計画と判断理由を同じファイルで読める。

失うもの:

- 判断だけを後から探しにくい。
- 実装ログが長期的な設計判断と短期的な作業記録を兼ね、役割が曖昧になる。

### 3. `docs/design.md` に判断理由も集約する

設計文書に、結論だけでなく背景と代替案も書く。

得るもの:

- 設計に関する情報が一つの文書に集まる。
- 読むべき場所が少ない。

失うもの:

- `docs/design.md` が履歴文書になり、現在有効な設計を読み取りにくくなる。
- 代替案や過去判断が増えるほど、設計の現在形が埋もれる。

### 4. GitHub issue や PR 本文に判断理由を書く

判断理由を GitHub 上の議論に残す。

得るもの:

- レビューや議論の流れと近い場所に判断を書ける。
- リポジトリ内の文書量を増やさずに済む。

失うもの:

- ローカル checkout だけで判断理由を読めない。
- issue や PR の粒度に依存し、設計判断の一覧性が落ちる。

## Decision

トレードオフを伴う判断は `docs/adr/` に ADR として記録する。
ADR は `NNN-kebab-case-topic.md` の連番ファイルにする。
フォーマットは `docs/adr/template.md` に置く。

ADR の作成と更新の手順は `.agents/skills/adr-workflow` に置く。
既存の `feature-workflow` は、トレードオフを伴う判断がある場合に `adr-workflow` を使うようにする。

`docs/design.md` は現在有効な設計を書く文書として維持する。
`docs/plans/` は実装計画と検証ログを書く文書として維持する。

## Consequences

良い影響:

- 判断の背景、選択肢、不採用理由、影響を後から参照しやすくなる。
- 設計文書と実装ログの役割を分けられる。
- サブエージェントを含む Codex 作業で、ADR 作成の手順を共有できる。

悪い影響:

- 判断を伴う変更では、コードやテスト以外に ADR を更新する手間が増える。
- ADR と `docs/design.md` の内容が重複しないように点検する必要がある。

中立的な影響:

- 過去判断を置き換える場合は、新しい ADR を作って `Supersedes` と `Superseded by` を更新する。
- 局所的な実装判断や短期メモは ADR にせず、`docs/plans/` に残す。

## Scope

この ADR は、リポジトリ内の設計判断、運用判断、エージェント作業手順に適用する。
利用者向け README の機能説明や、通常のバグ修正手順には直接適用しない。

## Follow-up

- `docs/adr/README.md` と `docs/adr/template.md` を追加する。
- `.agents/skills/adr-workflow` を追加する。
- `.agents/skills/feature-workflow` から ADR 作成手順を参照する。
- 開発者向けドキュメントに `docs/adr/` の役割を追加する。

## References

- [docs/plans/030-adr-workflow.md](../plans/030-adr-workflow.md)
- [docs/design.md](../design.md)
- [docs/plans/](../plans/)
