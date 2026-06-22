# 実行プラン: レビュー指摘とテスト未カバー対応

## Context

現在の実装レビューでは、Vitest / typecheck / lint / format / build / VSCode E2E は成功している一方で、実害のある LSP 挙動のズレと、プロセス配線まわりの未カバー領域が残っている。

特に優先度が高い課題は次のとおり。

- ラベル rename が参照側の `%` を消し、`br label %exit` を `br label done` にしてしまう。
- 命令結果型推定が `select` / `extractelement` / `extractvalue` / `cmpxchg` / `atomicrmw` などで LangRef とズレる。
- completion が位置を見ず、別関数のローカル値やラベルを候補に出す。
- hover が参照位置ではなく定義位置の range を返し、opcode / type token の docs hover も使えていない。
- references が LSP の `includeDeclaration` を無視する。
- `server.ts` と `vscode-extension/src/extension.ts` が通常カバレッジ 0% で、設定変更・キャンセル・ファイル監視・起動配線の退行を検出しにくい。

このプランでは、既存の「純粋ドメイン層を厚くテストし、副作用はアダプタ層で隔離する」方針を維持しながら、バグ修正は再現テストから進める。

## スコープ

### やること

1. P1 バグの再現テストと修正
   - label rename は、定義 `exit:` と参照 `%exit` の置換文字列が異なることをテストで固定する。
   - 命令結果型推定は、LangRef 上で結果型が opcode 直後の型と一致しない代表命令をテーブル化してテストする。
2. P2 の LSP 挙動修正
   - completion を現在位置のスコープで絞り込む。
   - hover range を実際のホバー出現範囲へ合わせる。
   - opcode / type token の hover docs を追加する。
   - references で `includeDeclaration` を尊重する。
3. 未カバー分岐のテスト補強
   - `verifier.ts` の `enabled=false`、exit 0、abort、空 stderr、warning 行、AbortSignal 伝搬を追加する。
   - `features.ts` の未解決位置、formatting no-op、range clamp、codeAction の対象外診断を追加する。
   - `analyzer.ts` の `source` 省略、`reportUndefinedReferences=false`、型推定不能、壊れた `blockaddress` を追加する。
   - parser / lexer / type / file reference の境界ケースを追加する。
4. `server.ts` のテスト容易化
   - `createServer(connection, documents, deps)` のような注入可能な形へ配線を分離する。
   - entrypoint は `connection.listen()` だけを持つ薄いファイルに寄せる。
   - initialize、change/open/close、configuration reset、workspace file events、verifier debounce / stale snapshot 破棄を単体テストする。
5. VSCode extension のテスト補強
   - `activate` の server options / document selector / watcher 設定を unit test 可能に切り出す。
   - E2E は既存の hover / definition / CFG に加え、rename と inlay hint の最小シナリオを追加する。

### やらないこと

- LLVM verifier 全体の再実装。
- datalayout に依存するサイズ計算や完全な型検査。
- すべての LLVM opcode の専用 AST 化。
- Webview ベースの CFG UI 作り込み。
- LLVM バージョン別モード。

## 実行順序

### 1. Red: P1 バグの再現

- `packages/language-server/src/lsp/features.test.ts`
  - label rename:
    - `exit:` の定義は `done:` に変わる。
    - `br label %exit` の参照は `%done` に変わる。
    - 新名に `%done` を渡しても定義は `done:`、参照は `%done` になる。
- `packages/analyzer/src/semantic/analyzer.test.ts`
  - `select i1 %c, i32 %a, i32 %b` の結果型は `i32`。
  - `extractelement <4 x i32> %v, i32 0` の結果型は `i32`。
  - `extractvalue { i32, i1 } %p, 1` の結果型は `i1`。
  - `cmpxchg ptr %p, i32 %old, i32 %new ...` の結果型は `{ i32, i1 }`。
  - `atomicrmw add ptr %p, i32 1 ...` の結果型は `i32`。

### 2. Green: 最小修正

- rename は `IdentifierRef.kind` と定義範囲一致を見て、label 定義と label 参照で置換文字列を分ける。
- 型推定は opcode ごとの小さな分岐を追加し、未対応や曖昧な集約型は誤表示より `undefined` を優先する。
- 既存 API の戻り値形状は保ち、LSP アダプタ側の変更範囲を狭くする。

### 3. P2 修正とテスト

- completion:
  - 関数外ではモジュールスコープだけを返す。
  - 関数内ではモジュールスコープ + 現在関数スコープを返す。
  - 別関数の parameter / local / label は返さない。
- hover:
  - 参照上の hover range は参照そのものの範囲にする。
  - opcode token 上で `opcodeDocs` を返す。
  - type token 上で `typeDocs` を返す。
- references:
  - `includeDeclaration=false` なら definition と同一 range を除外する。
  - `includeDeclaration=true` と未指定は既存どおり定義を含める。

### 4. アダプタ層のテスト容易化

- `server.ts` は副作用を entrypoint に閉じ込め、ハンドラ登録と状態更新を injectable にする。
- fake connection / fake documents / fake timers を使い、次をテストする。
  - initialize capabilities。
  - 設定変更で診断・verifier・inlay hint の cache が破棄される。
  - 古い snapshot の verifier 結果を publish しない。
  - close で diagnostics を空にし、pending timer と AbortController を破棄する。
  - watched file の create/change/delete で workspace symbol / call hierarchy index が更新される。

### 5. カバレッジ補強

- `verifier.ts`
  - `enabled=false`。
  - runner exit 0。
  - `aborted=true`。
  - 非0終了かつ stderr 空。
  - stderr の warning 行。
  - AbortSignal を runner request へ渡す。
- parser / lexer / type
  - `#foo` 非 debug record。
  - 未終端 block comment。
  - `uselistorder_bb`。
  - debug record がラベル前に出る暗黙ブロック。
  - packed empty struct `<{}>`。
  - function type の不正 parameter。
- file references / document links
  - filename 欠落、空文字、directory 欠落。
  - directory 末尾 `/` と `\`。
  - `\22` と `\\` の復号。
  - 非 file URI と不正 workspace URI。

## 検証方法

各段階で次を実行する。

```sh
pnpm test
pnpm test:coverage
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm --filter llvm-analyzer-vscode test:e2e
```

完了条件は次のとおり。

- 既存テストと追加テストがすべて成功する。
- P1/P2 findings の再現テストが Red から Green になっている。
- `server.ts` と `extension.ts` の 0% カバレッジ状態を解消する。
- カバレッジ未達のうち、防御分岐・到達不能分岐として残すものは理由をコメントまたはテスト名で説明する。
- README / docs/design.md / docs/roadmap.md に仕様変更が必要な場合だけ更新する。
