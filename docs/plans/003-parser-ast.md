# プラン: parser AST + 再帰下降パーサ

> 実行プランのログ。過去のプランは書き換えず、ここに追記している。

## Context

[roadmap.md](../roadmap.md) のフェーズ「parser: AST + 再帰下降パーサ」を実装する。
[lexer フェーズ](./002-parser-lexer.md) で得た `tokenize(source): Token[]` を入力に、
LLVM IR の構文木（AST）を組み立てる純粋関数 `parseModule(source)` を追加する。
これは analyzer（シンボル表 / 定義参照インデックス / 型解決）と LSP
（definition / references / documentSymbol / foldingRange / diagnostics）の土台になる。

対象は最新安定 LLVM IR（opaque pointer `ptr`）。`vscode`/LSP には一切依存しない純粋関数として実装し、
環境非依存で網羅的にユニットテストできる状態を保つ。

## スコープ

要件確認の結果、粒度は **「構造重視・命令は粗く」** を採用する。
トップレベル構造は型付きノードに分解するが、命令や型の内部は構造化せず、
出現する識別子参照（`@`/`%`/`!`/`#`/`$` とラベル）を収集する方針にとどめる。
定義位置・参照位置が取れれば LSP の主要機能（definition/references/outline/folding）が成立する。

### やること

- `packages/parser/src/ast/`: ノード型定義。各ノードは lexer の `Range` を持つ。
  - `Module { entries: TopLevelEntry[] }`
  - 共通フィールド: `range`、`defines?`（このエントリが導入する名前）、`references`（出現する参照列）。
  - `TopLevelEntry` のバリアント（判別は `kind`）:
    - `SourceFilename`（`source_filename = "..."`）
    - `TargetDefinition`（`target datalayout|triple = "..."`）
    - `TypeDefinition`（`%name = type ...`）
    - `GlobalVariable`（`@name = ...`。alias/ifunc も最小では同種別に寄せる）
    - `FunctionDeclaration`（`declare ... @name(...)`）
    - `FunctionDefinition`（`define ... @name(...) { blocks }`、本体を `BasicBlock[]` に分解）
    - `AttributeGroupDefinition`（`attributes #N = {...}`）
    - `MetadataDefinition`（`!name = ...` / `!N = ...`、`distinct` 可）
    - `UnknownEntry`（エラー回復用。解釈不能な行を保持）
  - `BasicBlock { label?, instructions: Instruction[] }`
  - `Instruction { result?, opcode?, operands: IdentifierRef[] }`
  - `IdentifierRef { kind, name, range }`（`GlobalRef`/`LocalRef`/`MetadataRef`/`LabelRef`/`AttributeGroupRef`/`ComdatRef`）
- `packages/parser/src/parser/`: 再帰下降パーサ `parseModule(source): { ast: Module; diagnostics: ParseDiagnostic[] }`。
  - **行ベース**で走査する（LLVM IR は 1 行 1 文が実体。`define` 本体だけ `{`...`}` ブロック）。
  - 先頭トークンでトップレベルエントリをディスパッチ。`define` はブレースのネストで終端判定。
  - **エラー回復付き**: 行のパースに失敗しても診断を 1 件積んで次の行へ進み、全体を止めない。
  - `ParseDiagnostic { range, message, severity }`。
- `src/index.ts` から `parseModule` / AST 型 / `ParseDiagnostic` を再エクスポート。

### やらないこと（このフェーズ外）

- 型の構造化（`[13 x i8]` / `{ i32, i32 }` 等）。生トークン範囲にとどめ、型解決は analyzer の責務。
- 各オペコード専用の AST ノード（`getelementptr` 等の意味構造）。
- シンボル解決・未定義参照などの意味診断（analyzer フェーズ）。parser は構文診断のみ。
- 複数行にまたがる文字列リテラル等の特殊ケースの厳密対応（通常出力は 1 行 1 文）。

## 検証方法

- 構文パターン（空 / target / source_filename / type / global / declare / define・複数ブロック /
  attributes / named metadata / metadata def / エラー回復）から網羅的にテストを設計し、Red を確認してから実装。
- 不変条件: 全 `IdentifierRef` で `source.slice(range...) === name`、ノードの `range` が子を包含する。
- `examples/hello.ll` 相当を `parseModule` に通し、entries 種別列・各関数のブロック/命令・参照収集を検証。
- `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm format` / `pnpm test:coverage` が全てグリーン。
