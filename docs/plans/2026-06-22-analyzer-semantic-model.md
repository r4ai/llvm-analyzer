# analyzer: 意味モデル

## Context

parser は LLVM IR を構造重視の AST に変換できるようになった。
次の language-server フェーズで definition / references / diagnostics / hover / documentSymbol を実装するには、AST から環境非依存の意味モデルを作る純粋ドメイン層が必要になる。

## スコープ

今回やること。

- `packages/analyzer` を新設する。
- `analyze(ast)` でシンボル表、モジュールスコープ、関数スコープ、定義参照インデックスを構築する。
- `symbolAt` / `definitionAt` / `referencesOf` / `documentSymbols` / `diagnostics` を提供する。
- 重複定義と未定義参照の診断を出す。
- SSA 値の型を、parser の粗い命令 AST から安全に推定できる範囲で解決する。
- オペコード・型のドキュメント辞書を提供する。

今回やらないこと。

- LLVM IR 型構文の完全な構造化。
- 全オペコードの厳密な型推論。
- LSP や VSCode API への接続。
- parser AST の大幅な変更。

## 探索メモ

状態は以下で分ける。

| 出現               | スコープ   | 期待                                                       |
| ------------------ | ---------- | ---------------------------------------------------------- |
| トップレベル定義   | モジュール | 同名重複を診断し、定義を登録する                           |
| 関数定義名         | モジュール | 関数シンボルとして登録する                                 |
| 関数引数 `%x`      | 関数       | パラメータとして登録する                                   |
| 基本ブロックラベル | 関数       | ラベルとして登録する                                       |
| 命令結果 `%v`      | 関数       | SSA 値として登録し、推定型を保持する                       |
| モジュール参照     | モジュール | 定義があればリンクし、無ければ未定義診断                   |
| 関数内ローカル参照 | 関数       | ローカル定義またはラベル定義へリンクし、無ければ未定義診断 |

## 検証方法

- Red: analyzer のユニットテストを先に追加し、未実装で失敗することを確認する。
- Green: `packages/analyzer` を実装してテストを通す。
- Refactoring: 型と責務を整理し、公開 API を `src/index.ts` に集約する。
- 最終確認: `pnpm test` / `pnpm test:coverage` / `pnpm typecheck` / `pnpm lint` / `pnpm format`。
