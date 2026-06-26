---
name: feature-workflow
description: このリポジトリで機能・フェーズを実装する際の標準ワークフロー。プラン作成 → 仮説検証ループでの実装 → ドキュメント更新の3ステップを回す。新機能やロードマップの次フェーズに着手するとき、実装方針を整理したいときに使用する。
---

LLVM IR LSP 拡張機能の開発で、機能やロードマップのフェーズを実装するときの標準手順。
全体設計は [docs/design.md](../../../docs/design.md)、進捗は [docs/roadmap.md](../../../docs/roadmap.md)、過去のプランは [docs/plans/](../../../docs/plans/) を参照する。
コーディング規約は [AGENTS.md](../../../AGENTS.md) に従う（カプセル化・関心の分離・契約による設計・副作用の隔離、古典派TDD、日本語ドキュメント、TSDoc）。

## ステップ1: プランを立て、`docs/plans/` に作成

1. 不明点は決め打ちせず、`AskUserQuestion` で質問して要件を確定する。
2. `docs/design.md` / `docs/roadmap.md` を読み、対象フェーズの範囲と既存方針を把握する。
3. トレードオフを伴う設計判断・運用判断がある場合は、[`adr-workflow`](../adr-workflow/SKILL.md) に従って `docs/adr/` に ADR を作成する。
   `docs/plans/` は実装ログ、`docs/adr/` は判断理由の記録として分ける。
4. `docs/plans/` の既存ファイルで最大の連番を確認する。
   次の 1-indexed な連番で `docs/plans/NNN-<topic>.md` に**ログとして**作成する。
   `NNN` は `001` から始め、古い順に並ぶようゼロ埋めする。
   以下を含める:
   - **Context**: なぜこの変更が必要か（解決する課題・きっかけ・期待する成果）。
   - **スコープ**: 今回やること／やらないこと。最小実装を意識し、欲張らない。
   - **検証方法**: どう動作確認するか（テスト・コマンド・手動確認）。
5. `docs/plans/` は追記専用のログ。過去のプランは書き換えず、新しい連番ファイルを足す。

## ステップ2: 仮説検証を繰り返して実装

AGENTS.md の古典派TDD（**探索 → Red → Green → Refactoring**）で進める。

1. **探索**: 状態遷移表などで対象の振る舞いを洗い出し、テストケースを網羅的に設計する。
2. **Red**: 失敗するテストを先に書き、落ちることを確認する（バグ修正なら再現テストから）。
3. **Green**: テストが通る最小実装を書く。
4. **Refactoring**: 可読性・保守性を高める。純粋ドメイン層（parser/analyzer）は `vscode`/LSP に依存させず、環境非依存でテストできる状態を保つ。
5. こまめに検証を回す:
   ```sh
   pnpm test         # vitest
   pnpm typecheck    # tsc
   pnpm lint         # oxlint
   pnpm format       # oxfmt --check
   ```
   小さく区切り、各サイクルで上記がグリーンであることを確認しながら前進する。

## ステップ3: ドキュメントを更新してコミット

1. **roadmap更新**: [docs/roadmap.md](../../../docs/roadmap.md) の該当項目のチェックボックスを更新する。
2. **design更新**: 設計判断が変わった／増えたら [docs/design.md](../../../docs/design.md) に反映する。
3. **ADR更新**: トレードオフを伴う判断がある場合は、[docs/adr/](../../../docs/adr/) に ADR があるか確認する。
4. **関連ドキュメント点検**: README やその他のドキュメントに古い記述が残っていないか確認する。
5. **changeset追加**: 利用者へ届く変更は `pnpm changeset` で `llvm-analyzer-vscode` の changeset を追加する。release 不要の変更は `pnpm changeset --empty` を追加する。判断に迷う場合は [release-workflow](../release-workflow/SKILL.md) に従う。
6. **コミット**: 意味のある単位に分け、Conventional Commits でコミットする（`git-commit` スキルに従う）。
   - 例: `feat(parser): add llvm ir lexer` / `docs: update roadmap`

## チェックリスト

- [ ] 不明点を質問し、要件を確定した
- [ ] トレードオフを伴う判断がある場合は `docs/adr/` に ADR を作成した
- [ ] `docs/plans/NNN-<topic>.md` にプランを作成した（Context / スコープ / 検証）
- [ ] 探索 → Red → Green → Refactoring のループで実装した
- [ ] `pnpm test` / `typecheck` / `lint` / `format` が全てグリーン
- [ ] `docs/roadmap.md` のチェックボックスを更新した
- [ ] 必要なら `docs/design.md` ・README を更新した
- [ ] `pnpm changeset` または `pnpm changeset --empty` を追加した
- [ ] Conventional Commits でコミットした
