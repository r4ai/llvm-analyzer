# Devbox 移行

## Context

開発ツール管理を mise から Devbox へ移行する。
Node.js、pnpm、lefthook、pinact の導入経路を Devbox に寄せ、ローカルと CI のセットアップ手順をそろえる。

## スコープ

- `mise.toml` を削除し、`devbox.json` で開発ツールを管理する。
- GitHub Actions の mise setup を Devbox setup に置き換える。
- CI 内の pnpm / pinact / node 実行を `devbox run -- ...` 経由にする。
- 開発ドキュメントと roadmap の mise 記述を Devbox に更新する。

次のことは今回の対象外とする。

- パッケージ依存の更新。
- VSCode 拡張機能の振る舞い変更。

## 検証方法

- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pinact run --check`

ローカル環境では Nix が未導入で、`devbox add` に対話的な sudo が必要だったため、`devbox.lock` の生成は CI 側の Devbox 解決に委ねる。
