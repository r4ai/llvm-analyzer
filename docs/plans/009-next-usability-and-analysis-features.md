# プラン: 次期利便性・解析機能

## Context

現在は LLVM IR 向けに syntax highlight と基本 LSP 機能、軽量診断、外部 LLVM verifier 連携まで実装済みである。
次の段階では、単一ファイル内の定義参照に閉じた体験から、IR を読む・直す・調査する作業を直接助ける体験へ広げる。

対象は以下の 9 機能とする。

- Code Action / Quick Fix
- 型構文パーサ
- Inlay Hints
- Control Flow Graph 表示
- Workspace Symbols
- Call Hierarchy
- Document Link
- Format / Range Format
- 診断レベル設定

LLVM バージョン別モードは今回の計画から外す。
理由は、現状の最新 LangRef 追従方針と競合しやすく、命令・属性・型の辞書管理を複雑化させるためである。

## 方針

大きな機能を一度に入れず、解析モデルの土台を先に増やす。
純粋ドメイン層で再利用できる情報を作ってから、language-server と vscode-extension のアダプタへ接続する。

実装順は以下を基本とする。

1. 型構文パーサ
2. 診断レベル設定
3. Inlay Hints
4. Workspace Symbols
5. Call Hierarchy
6. Document Link
7. Format / Range Format
8. Control Flow Graph 表示
9. Code Action / Quick Fix

Code Action は最後に置く。
修正候補は診断、型情報、CFG、ワークスペース索引の品質に依存するため、先に基盤を揃えた方が小さく実装できる。

## フェーズ1: 型構文パーサ

### スコープ

やること:

- `packages/parser` に LLVM IR 型構文を扱う純粋パーサを追加する。
- 最初の対象は scalar / pointer / vector / array / struct / function type / named type / opaque struct とする。
- `ptr addrspace(N)`、typed pointer、可変長引数、packed struct を扱う。
- analyzer の型推定で、既存の文字列ベース推定を型 AST ベースへ段階的に置き換える。
- 型 hover と completion の表示品質を上げる。

やらないこと:

- 全命令の厳密な型検査。
- target datalayout に依存するサイズ計算。
- LLVM verifier 相当の型整合性検証。

### 検証方法

- 型構文の状態表を作り、lexer/parser/analyzer のユニットテストを Red → Green で追加する。
- `pnpm test`
- `pnpm test:coverage`
- `pnpm typecheck`

## フェーズ2: 診断レベル設定

### スコープ

やること:

- parser / analyzer / external verifier の診断ソースごとに有効化と severity を設定できるようにする。
- 設定値は language-server のアダプタ層で解釈し、純粋層には持ち込まない。
- 生成途中の IR や独自方言を読むユーザー向けに、診断を抑制できる逃げ道を用意する。

やらないこと:

- 診断メッセージの国際化。
- LLVM バージョン別の診断切り替え。

### 検証方法

- 設定ごとの publishDiagnostics 結果を language-server の結合テストで確認する。
- VSCode contributes.configuration の schema を確認する。
- `pnpm test`
- `pnpm typecheck`

## フェーズ3: Inlay Hints

### スコープ

やること:

- SSA 値の推定型を inlay hint として表示する。
- 必要なら基本ブロックの predecessor 数など、CFG 実装に先行して安全に計算できる情報を追加する。
- 表示量が多くなりすぎないよう、種類ごとに設定で切り替えられるようにする。

やらないこと:

- 全命令の完全な型推論。
- デバッグ情報由来の高級言語変数名表示。

### 検証方法

- analyzer の型モデルを使った unit test。
- language-server の `textDocument/inlayHint` テスト。
- `pnpm test`
- `pnpm typecheck`

## フェーズ4: Workspace Symbols

### スコープ

やること:

- `.ll` ファイル単位の解析結果をワークスペース内で索引化する。
- `@function`、`@global`、`%type`、`!metadata`、属性グループを workspace symbol として返す。
- ファイル変更・削除に追従し、古い索引を破棄する。

やらないこと:

- クロスファイルの厳密なリンク解決。
- bitcode や object file の読み取り。

### 検証方法

- 複数ファイルを使う language-server 結合テスト。
- ファイル削除・変更時に索引が更新されることを確認する。
- `pnpm test`
- `pnpm typecheck`

## フェーズ5: Call Hierarchy

### スコープ

やること:

- `call` / `invoke` / `callbr` の直接呼び出し先 `@name` を抽出する。
- 関数定義から callers / callees を返す。
- Workspace Symbols の索引を再利用し、複数ファイルをまたぐ直接呼び出しを扱う。

やらないこと:

- 関数ポインタや `bitcast` 経由の間接呼び出し解決。
- インラインアセンブリ中の呼び出し解釈。

### 検証方法

- analyzer の呼び出し抽出ユニットテスト。
- language-server の call hierarchy 結合テスト。
- `pnpm test`
- `pnpm typecheck`

## フェーズ6: Document Link

### スコープ

やること:

- `source_filename` と debug metadata のファイルパス候補を document link として返す。
- ワークスペース相対パスと絶対パスを安全に解決する。
- 存在しないファイルはリンク化しない、または設定で切り替える。

やらないこと:

- 任意コメント内 URL の広範な抽出。
- DWARF debug metadata の完全解釈。

### 検証方法

- parser/analyzer 側でファイル参照候補を抽出するユニットテスト。
- language-server の `textDocument/documentLink` テスト。
- `pnpm test`
- `pnpm typecheck`

## フェーズ7: Format / Range Format

### スコープ

やること:

- まず range format を実装し、選択範囲内の空白・インデントを安定化する。
- 関数本体、基本ブロック、トップレベル定義の代表ケースを対象にする。
- AST を壊さない範囲で edit を返し、意味を変える整形はしない。

やらないこと:

- 完全な pretty printer。
- コメント再配置。
- 複数行定数や metadata の積極的な折り返し。

### 検証方法

- 入力と期待出力の snapshot 的ユニットテスト。
- format 後も `parseModule` で同等の主要ノードが得られることを確認する。
- `pnpm test`
- `pnpm typecheck`

## フェーズ8: Control Flow Graph 表示

### スコープ

やること:

- analyzer に関数単位の CFG モデルを追加する。
- `br` / `switch` / `indirectbr` / `invoke` / `callbr` のうち、静的に分かる successor を抽出する。
- VSCode command から現在の関数の CFG を Mermaid または DOT として表示・コピーできるようにする。
- 最初は Webview の作り込みより、正しいグラフデータと出力を優先する。

やらないこと:

- SSA def-use graph の可視化。
- LLVM pass pipeline の可視化。
- 間接分岐先の完全解決。

### 検証方法

- analyzer の CFG ユニットテスト。
- command から出力される Mermaid / DOT の結合テスト、または E2E の最小確認。
- `pnpm test`
- `pnpm typecheck`

## フェーズ9: Code Action / Quick Fix

### スコープ

やること:

- 診断コードを安定化し、修正可能な診断だけ code action を返す。
- 最初の候補は以下に絞る。
  - 未定義ラベルに対する近いラベル名への置換。
  - 未定義グローバルに対する近いグローバル名への置換。
  - verifier 実行不可時の設定変更案内。
  - 終端命令後の通常命令に対する範囲選択または削除候補。
- quick fix が危険な場合は edit を返さず、command や情報提示に留める。

やらないこと:

- IR の意味を推測して新しい命令やブロックを生成する修正。
- 外部 LLVM verifier の全エラーに対する自動修正。
- マルチファイル rename 相当の大規模 edit。

### 検証方法

- analyzer 診断に stable code が付くことを unit test で確認する。
- language-server の `textDocument/codeAction` テスト。
- 危険な診断では action を返さないことを確認する。
- `pnpm test`
- `pnpm typecheck`

## 共通の完了条件

- 各フェーズで `docs/plans/` に個別実装ログを追加する。
- `docs/design.md` と `docs/roadmap.md` を更新する。
- README または VSCode extension README のユーザー向け機能一覧を更新する。
- `pnpm test`
- `pnpm test:coverage`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`
- Conventional Commits でコミットする。
