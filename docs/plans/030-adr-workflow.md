# プラン: ADRフォーマットと作成スキル

## Context

トレードオフを伴う判断は、実装ログだけでは後から理由を追いにくい。
現在の設計は `docs/design.md` にまとまっているが、そこに代替案や不採用理由まで載せると現在形の設計が読みにくくなる。

今後は、判断の背景、代替案、採用理由、影響を `docs/adr/` に残す。
同じ判断基準で運用できるように、repo-local skill も追加する。

## スコープ

- `docs/adr/README.md` と `docs/adr/template.md` を追加する。
- 今回の判断を `docs/adr/001-record-tradeoff-decisions-as-adrs.md` として記録する。
- `.agents/skills/adr-workflow` を追加する。
- `feature-workflow` と開発者向けドキュメントから ADR の役割を参照する。

## やらないこと

- 既存の全 plan を ADR に変換しない。
- 既存の設計判断を網羅的に掘り起こさない。
- ADR の生成スクリプトや CI 強制はまだ追加しない。

## 検証方法

- `adr-workflow` skill の frontmatter を `quick_validate.py` で確認する。
- `pnpm format` で Markdown と YAML の整形を確認する。
- `pnpm changeset status --since=origin/main` で PR の changeset 要件を確認する。
