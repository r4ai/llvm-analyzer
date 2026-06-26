# ADR運用

このディレクトリには、トレードオフを伴う設計判断や運用判断を Architecture Decision Record として記録する。
ADR は実装ログではなく、後から判断の理由を参照するための文書である。

## 書く対象

次のような判断は ADR に残す。

- パッケージ責務や依存方向を変える判断。
- セキュリティ境界や信頼境界を決める判断。
- リリース方式、CI、配布、外部サービス連携を変える判断。
- 外部ツール、実行環境、テスト戦略を選ぶ判断。
- 互換性、サポート範囲、非目標を明示する判断。

局所的な実装手順、調査ログ、短期的な作業メモは `docs/plans/` に書く。
ADR は、複数の選択肢とそのコストがある判断に絞る。

## ファイル名

ファイル名は `NNN-kebab-case-topic.md` にする。
`NNN` は `001` から始まる3桁の連番である。
過去の ADR は原則として追記型の履歴として扱う。

## Status

`Status` は次のいずれかにする。

- `Proposed`: まだ採用前の提案。
- `Accepted`: 採用済みの判断。
- `Deprecated`: 現在は推奨しないが、直接の置き換え先がない判断。
- `Superseded`: 新しい ADR に置き換えられた判断。

判断が変わる場合は、既存 ADR を大きく書き換えず、新しい ADR を作る。
その場合は `Supersedes` と `Superseded by` で相互に参照する。

## 文書の役割

| 文書              | 役割                                       |
| ----------------- | ------------------------------------------ |
| `docs/design.md`  | 現在有効な設計を書く。                     |
| `docs/roadmap.md` | 実装フェーズと進捗を書く。                 |
| `docs/plans/`     | 各フェーズの実装計画と検証ログを書く。     |
| `docs/adr/`       | 判断の背景、代替案、採用理由、影響を書く。 |

ADR の結論が現在設計に影響する場合は、`docs/design.md` にも現在形で反映する。
ただし、代替案や採用理由の詳細は ADR に寄せ、同じ説明を重複させない。

## 作成手順

1. `template.md` を読み、次の連番で新しい ADR を作る。
2. `Status`、`Date`、`Context`、`Decision Drivers`、`Considered Options`、`Decision`、`Consequences` を埋める。
3. 不採用案には、どの制約に合わなかったかを書く。
4. `References` に関連する plan、design、PR、issue を置く。
5. 関連する `docs/design.md`、`docs/roadmap.md`、`.agents/skills/` の更新漏れを確認する。
