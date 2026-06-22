# 実装ログ: Hover UX

## Context

既存の Hover は SSA 値の名前、種別、型だけを日本語で表示していた。
LLVM IR では `%x` や `%sum` の値名だけでは情報量が少なく、利用者は定義元の関数シグネチャや命令行を追加で探す必要があった。
Rust Analyzer や clangd の Inlay/Hover 系 UI と同じく、画面上の補助表示は短く保ち、詳細は hover の markdown に集約する。

## スコープ

- `parameter` と `local` の Hover を英語で短く表示する。
- parameter には関数シグネチャ、local には定義命令を markdown の `llvm` コードブロックで表示する。
- global / function / type などの既存 Hover も英語表記へ揃える。
- analyzer の型推定範囲は広げない。
- 新しい設定項目は追加しない。

## 検証方法

- `packages/language-server/src/lsp/features.test.ts` に Hover markdown の期待値を追加し、Red を確認する。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format` を実行する。
- README と design の Hover 記述が古くないか確認する。
