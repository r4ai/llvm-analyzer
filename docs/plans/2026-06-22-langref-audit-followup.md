# 2026-06-22 プラン: LangRef 追従監査フォローアップ

## Context

最新 LLVM Language Reference Manual 23.0.0git を再確認すると、前回の「最新 LangRef 準拠差分」後も、合法な IR を LSP 解析で取りこぼす可能性が残っている。
今回の目的は LLVM verifier 全体の再実装ではなく、既存設計の「構造重視・命令は粗く」を保ったまま、字句解析・粗い AST・意味解析で明確に誤る箇所を追加で潰すこと。

特に、最新 LangRef の数値リテラル、アドレス空間付きポインタ型を含む引数、複数行 debug record は、現実の IR に出やすく、現在の補完・参照解決・診断に直接影響する。

## スコープ

やること:

- 公式 LangRef を参照し、lexer / parser / analyzer / LSP 表面を領域ごとに監査する。
- 再現テストを先に追加し、現在の実装で落ちることを確認する。
- `f0x...` と `+nan(0x...)` / `+snan(0x...)` 形式の数値リテラルを lexer で壊さず読む。
- `ptr addrspace(N) %p` のような複合ポインタ型を含む関数引数を parameter として解決する。
- 複数行の `#dbg_*` record を 1 レコードとして扱い、SSA 参照を未定義誤診断しない。
- 関数スコープの use-list order directive、複数行命令、改行を含む文字列を物理行で分断しない。
- PHI incoming label、`blockaddress`、metadata attachment key、関数宣言引数名の参照分類を修正する。
- `alloca` / `getelementptr` / `icmp` / `fcmp` の軽量な結果型推定を LangRef に寄せる。
- 必要なドキュメントとロードマップの注記を更新する。
- Conventional Commits でコミットする。

やらないこと:

- 命令ごとの完全 AST、型検査、dominance / CFG / memory model の完全 verifier。
- LangRef の全属性・全メタデータ名を補完辞書へ完全同期すること。
- target 固有拡張や bitcode 表現の網羅。

## 検証方法

- `pnpm --filter @llvm-analyzer/parser test`
- `pnpm --filter @llvm-analyzer/analyzer test`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`
