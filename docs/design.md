# 設計: LLVM IR Language Server VSCode拡張機能

LLVM IR (`.ll`) 向けにシンタックスハイライト・定義ジャンプ・参照検索・ホバー・アウトライン・診断・補完・リネームを提供するVSCode拡張機能の全体設計。
最新の LLVM LangRef（確認時点: 23.0.0git, opaque pointer `ptr`）を対象とし、古い typed pointer (`i8*`) 記法もパースは通すが警告しない。

## アーキテクチャ方針

pnpm workspace のモノレポ。**純粋ドメイン層（vscode/LSP非依存）とアダプタ層を分離**し、解析ロジックを環境非依存で徹底的にユニットテストできるようにする（AGENTS.md の古典派TDD・関心の分離・副作用の隔離に準拠）。

```
packages/
├── parser/          # [純粋] source → tokens → AST。副作用なし。最重要TDD対象
├── analyzer/        # [純粋] AST → 意味モデル（シンボル表/定義参照/型解決/診断）
├── language-server/ # [アダプタ] vscode-languageserver で analyzer をLSPに接続
└── vscode-extension/# [配布物] vscode-languageclient + TextMate文法 + contributes
```

依存方向: `vscode-extension → language-server → analyzer → parser`。
parser/analyzer は `vscode*` に一切依存しない。

## 各パッケージの責務

### parser（純粋・最重要）

- **lexer**: 状態遷移表ベースのトークナイザ。各トークンに `range`（offset/line/column, **0始まり**＝LSP互換）を保持。
  - 公開API: `tokenize(source: string): Token[]`（純粋関数、末尾に必ずゼロ幅の `Eof`）。
  - 不変条件: `source.slice(range.start.offset, range.end.offset) === token.value`。
  - 不正な文字は `Unknown` トークンとして残し解析を止めない（エラー回復）。
  - トークン種別: グローバル識別子 `@name`/`@"..."`/`@1`、ローカル識別子 `%name`/`%1`、ラベル (`name:`/`0:`)、
    メタデータ `!name`/`!0`、属性グループ `#0`、debug record `#dbg_*`、comdat `$name`、
    型キーワード (`i32`, `b32`, `ptr`, `void`, `float`…)、命令オペコード、定数 (`true`/`null`…)、数値（NaN payload / `f0x...` を含む）、文字列、コメント (`;` と `/* ... */`)、記号。
    バーワード（記号なしの語）は lexer 内で既知の語集合により種別まで分類する（未分類は `Identifier`）。
- **ast**: ノード型定義（Module / TypeDefinition / GlobalVariable / ComdatDefinition / ModuleAsm / UseListOrderDirective / FunctionDefinition / FunctionDeclaration / BasicBlock / Instruction / DebugRecord / IdentifierRef / MetadataDefinition…）。各ノードに `range`。
- **parser**: 再帰下降パーサ。**エラー回復付き**（1行の失敗で全体を止めず `UnknownEntry`＋診断で継続）で構文エラーを診断として収集。
  - **粒度は「構造重視・命令は粗く」**: トップレベル構造は型付きノードへ分解するが、命令内部は構造化せず、出現する識別子参照（`@`/`%`/`!`/`#`/`$`・ラベル）を {@link IdentifierRef} として収集するにとどめる。定義/参照位置が取れれば LSP の definition/references/documentSymbol/foldingRange が成立する。型構文は専用の type パーサで段階的に扱い、各オペコード専用ノードは将来フェーズとする。
  - **走査方針**: `define` 本体は `{`...`}` のブレース対応でブロックを切り出す。関数本体の命令・debug record・use-list order directive と、その他のトップレベルは通常 1 行 1 文として扱うが、`[]` / `{}` / `()` / `<>` や改行を含む文字列で複数行にまたがる場合は閉じるまで 1 要素として集める。
  - 各トップレベルエントリは共通で `defines?`（導入する名前）と `references`（本体の参照列）を持ち、analyzer のシンボル表/定義参照インデックスの直接の入力になる。
  - `IncrementalParserSession`はソースと解析結果を不変スナップショットとして所有する。
    明示的編集では対象要素を二分探索し、境界を安全に確定できない場合だけ全文解析へ戻る。
    初回解析はソース長`n`に対して`O(n)`である。
    トップレベル要素数`m`、再解析要素長`k`、移動する後続ASTノード数`a_s`に対し、局所編集は`O(log m + k + m)`、位置が動く編集は`O(log m + k + m + a_s)`である。
    公開ASTが絶対位置の配列を持つため、配列再構成の`O(m)`は明示的に残す。
- **type**: LLVM IR 型構文を AST 化する純粋パーサ。
  - 公開API: `parseLlvmType(source: string): { type?: LlvmType; diagnostics: ParseDiagnostic[] }`、`formatLlvmType(type): string | undefined`。
  - 対象: scalar / pointer / vector / array / struct / function type / named type / opaque struct。`ptr addrspace(N)`、typed pointer、可変長引数、packed struct を扱う。
  - 役割は構文構造の取得に限定し、target datalayout に依存するサイズ計算や verifier 相当の型整合性検証は行わない。
- **formatter**: LLVM IR 全体の行頭・行末空白と関数本体の基本インデントを安定化する純粋フォーマッタ。
  - 公開API: `formatLlvmIr(source: string): string`。
  - 現段階では pretty printer ではなく、トップレベル・ラベル・閉じブレースを左詰め、関数内の命令・コメントを2スペース字下げにする line-based 整形に限定する。
- 公開API例: `parseModule(source: string): { ast: Module; diagnostics: ParseDiagnostic[] }`

### analyzer（純粋）

- AST から **シンボル表 + スコープ** を構築する。
  - モジュールスコープ: `@global`、名前付き型 `%struct.Foo`、名前付きメタデータ、属性グループ。
  - 関数スコープ: ローカルSSA値 `%x`（パラメータ含む）、ラベル。
- **定義/参照インデックス**: 各シンボルの定義位置と全参照位置（Go to Definition / Find References / Rename の土台）。
  巨大IRでも参照数に対して二次時間にならないように、同じ定義出現の除外は定数時間で判定する。
  位置問い合わせ用の出現列は意味解析の完了時に一度だけソース順へ整列し、二分探索する。
  定義範囲、可視スコープ、関数範囲もソース順索引として保持し、範囲内シンボルと現在関数を二分探索する。
  全出現とシンボル別参照は同じ整列済み配列を再利用し、操作ごとに再整列しない。
- **型解決**: SSA値の型（Hover表示用）。parser の AST は命令内部を粗く保持するため、`analyze(ast, { source })` で元ソースを渡された場合に、関数引数と命令結果の直近型構文を `parseLlvmType` で読み、表示用文字列として安全に推定する。命令結果の型は最初の参照時に一度だけ推定し、初回読み込みと編集後の必須解析で画面外の型を計算しない。target datalayout に依存するサイズ計算や verifier 相当の型検査は扱わない。
- **診断**: 未定義値の参照、重複定義、同一命令内の自己参照、終端命令後の通常命令など（LLVM verifier 全体は再実装しない）。metadata attachment key、関数宣言の引数名、関数スコープの use-list order directive など、LangRef 上の非参照・非命令は誤診断しない。language-server で parser の構文診断とマージし、parser / analyzer / external verifier ごとに有効化と severity を適用する。
- **診断コード（予定）**: Code Action の土台として、修正候補を返せる診断には stable code を付与する。自動修正は意味を変えない置換や削除候補に限定し、危険な IR 生成は行わない。
- **CFG / 呼び出し情報**: 関数単位で basic block successor と直接呼び出し先を抽出する。CFG は `br` / `switch` / `indirectbr` / `invoke` / `callbr` の `label %bb` から静的に分かる範囲を対象にし、間接分岐や関数ポインタの完全解決は行わない。Mermaid 出力は analyzer の純粋関数で生成する。
- **ファイル参照候補**: `source_filename` と `!DIFile(filename:, directory:)` から、エディタ上でリンク化できるファイルパス候補を抽出する。存在確認と URI 解決は language-server 側の副作用として分離し、コメント内 URL や任意文字列は対象にしない。リンク先は workspace folder または IR ファイルのディレクトリ配下に限定する。
  性能ゲートは5サンプルの中央値を使い、数msで完了する処理はウォームアップ後のバッチ平均から入力増加率を判定する。
  単発の一時停止を除外しても継続する超線形な増加は残るため、正規化増加率の閾値は緩めない。
- オペコード/型/属性のドキュメント辞書を持ち、Hover/Completion で再利用。
- 公開API例: `analyze(ast, { source }): SemanticModel`、`SemanticModel.definitionAt(pos)` / `referencesOf(symbol)` / `symbolAt(pos)` / `documentSymbols()` / `diagnostics()`

### language-server（アダプタ）

- `vscode-languageserver/node` + `vscode-languageserver-textdocument`。VSCode 拡張から IPC で起動。
- ドキュメント変更をデバウンスし、待機中の`contentChanges`をバージョン順に保持する。
  単一トップレベル要素の内側に収まる編集では、更新前の範囲と更新後の終端をparser sessionへ渡し、その要素だけを再パースする。
  要素境界をまたぐ編集や構造境界を検証できない編集は全体パースへ戻る。
  意味モデルはモジュールをまたぐ参照の整合性を保つため、線形時間で全体を再リンクする。
  診断、Workspace Symbols、Call Hierarchyは同じ不変スナップショットを共有し、一回の変更を機能ごとに再解析しない。
  Inlay Hintsは要求範囲でシンボルを絞ってから表示用型を推定する。
  Document Symbols、Semantic Tokens、Folding Ranges、Document Link候補は同じ不変スナップショット内で再利用する。
  Range Formattingは現在関数を索引で判定し、選択行の断片だけを整形する。
  Workspace Symbolsは名前の三文字索引、Call Hierarchyはcallerとcalleeの索引を登録時に作る。
  合成した巨大IRの初回解析、全体再構築、インクリメンタル更新、表示範囲の型問い合わせ、各LSP操作の初回時間と再要求時間、索引共有は `pnpm benchmark:large-ir -- --check` で検証する。
- 外部 LLVM verifier は language-server の副作用として隔離する。即時診断は parser/analyzer が返し、`llvm-as` などの verifier は追加 debounce 後にバックグラウンド実行する。新しい編集が来たら古い結果は破棄し、実行中プロセスは中止する。
- ワークスペース横断機能は language-server 側で `.ll` ファイルごとの解析結果を索引化し、parser/analyzer の純粋 API から得たシンボル・呼び出し・ファイル参照候補を LSP 形式へ変換する。
  初期の workspace symbol 索引は URI 単位で `DocumentSnapshot` を保持し、open document・workspace folder 初期走査・watched file events で更新する。
- capability ↔ analyzer クエリの対応:
  - `hover` ← `symbolAt` + 型/ドキュメント辞書。シンボル参照では英語の短い markdown を返し、宣言形のコードブロック、Kind / Type / Scope の表、定義元行（parameter は関数シグネチャ、local は定義命令）を表示する。opcode/type/attribute token では短い意味、典型的な使い方、LLVM IR 例、公式 LangRef リンクを返す。opcode docs は lexer が扱う LangRef 命令と `define` / `declare` を網羅し、attribute docs は LangRef の parameter / function / global attributes と属性構文内の補助語を扱う。
  - `definition` / `references` ← 定義/参照インデックス。`references` は LSP の `includeDeclaration` を尊重する
  - `documentSymbol` ← `documentSymbols`
  - `semanticTokens/full` ← トークン分類
  - `publishDiagnostics` ← `diagnostics` + optional external LLVM verifier
  - `completion` ← 基本キーワード/オペコード/スコープ内識別子。関数内ではモジュールスコープと現在関数スコープ、関数外ではモジュールスコープだけを返す
  - `rename` ← 参照インデックス。ラベルは定義名（`exit:`）と参照名（`%exit`）で置換文字列を分ける
  - `foldingRange` ← 関数/ブロック範囲
  - `inlayHint` ← 型構文モデル + SSA値の推定型。初期実装では parameter / local の定義名直後に `: type` を表示し、`llvm-analyzer.inlayHints.types.enabled` で切り替える。
  - `workspace/symbol` ← ワークスペース索引。`@function` / `@global` / `%type` / `!metadata` / 属性グループなどのトップレベル定義を返す
  - `callHierarchy/*` ← 直接呼び出し索引。`call` / `invoke` / `callbr` の `@callee` だけを扱い、間接呼び出しは解決しない
  - `documentLink` ← `source_filename` / debug metadata のファイル参照候補。IR ファイルのディレクトリと workspace folder を基準に相対パスを解決し、それらの配下にある実在ローカルファイルだけを返す
  - `formatting` / `rangeFormatting` ← `formatLlvmIr` を使った空白・インデント edit。rangeFormatting は指定範囲と交差する行全体だけを置き換える
  - `codeAction` ← stable diagnostic code と安全な修正候補。初期実装では未定義グローバル・未定義ラベルの近い既存名への置換と、終端命令後の通常命令削除だけを quick fix として返す

### vscode-extension（配布物）

- `contributes.languages`（id `llvm`, `.ll`）/ `contributes.grammars`（`source.llvm`）/ `language-configuration.json`。
- TextMate文法は **LSP無しでも色が付く土台**。将来は Semantic Tokens で強調を上書き。
- `src/extension.ts` で `vscode-languageclient/node` を使い、esbuild で同梱した language-server を子プロセス起動する。
- CFG 表示など VSCode 固有の UI は extension 側の command として実装し、グラフ構築自体は analyzer の純粋モデルに置く。commandは独自LSP requestでLanguage Serverの解析済みスナップショットを使い、拡張ホストで再解析しない。初期表示形式は Mermaid を markdown の untitled document として開き、Webview の作り込みは後続に回す。
- 診断レベル、inlay hints、format、document link、verifier などの利用者設定は contributes.configuration に追加し、language-server へ渡す。診断レベル設定は language-server のアダプタ層で解釈し、parser / analyzer の純粋層には持ち込まない。

## LLVM IR固有のパース勘所

- **`%foo` の曖昧性**: 「ローカル値」と「名前付き型」の両方になりうる。出現位置（型位置 vs 値位置）で区別する。
- **数値ID**: グローバル/ローカルとも `@1`, `%2` のような暗黙の連番IDを取りうる。
- **ラベル（基本ブロック）**: ブロック先頭 `name:` で定義、`br label %name` 等で参照。
- **PHI / blockaddress のラベル**: `phi ... [value, %label]` と `blockaddress(@f, %label)` の `%label` はローカル SSA 値ではなくラベル参照として扱う。
- **debug record**: `#dbg_value(...)` などは命令列に混在するが命令ではないため、`Instruction` とは別の `DebugRecord` として保持する。
- **トップレベル指令**: `module asm`、comdat 定義、use-list order は定義参照インデックスのためにトップレベルノードとして保持する。
- **スコープ**:
  - モジュールスコープ: `@`グローバル / 名前付き型 / 名前付きメタデータ / 属性グループ `#`。
  - 関数スコープ: `%`ローカル（パラメータ含む） / ラベル。

## 配布

`@vscode/vsce` で `.vsix` をパッケージする。
`packages/vscode-extension` の `pnpm build` は extension と language-server と E2E suite を `dist/` へバンドルする。
`pnpm --filter llvm-analyzer-vscode package` で `llvm-analyzer-vscode.vsix` を作成する。

リリース管理は Changesets で行う。
利用者へ届く変更は `llvm-analyzer-vscode` の changeset として記録し、`main` への merge 後に `Release` ワークフローが Version PR を作る。
Version PR を merge すると、同じ `Release` ワークフローが VSIX を作成し、Marketplace publish と GitHub Release 作成を行う。
ただし publish は `packages/vscode-extension/package.json` がその push で変更され、かつ `llvm-analyzer-vscode@<version>` tag が未作成の場合だけ行う。
VSCode Marketplace への手動公開は GitHub Actions の `Publish VS Code Extension` ワークフローで行う。
長期 PAT は使わず、`vscode-marketplace` environment に紐づく GitHub OIDC subject を Microsoft Entra federated credential で信頼し、`azure/login` 後に `vsce publish --azure-credential` を実行する。
サプライチェーン攻撃時の影響範囲を抑えるため、VSIX 作成 job と公開 job を分離し、`id-token: write` は公開 job だけに付与する。
公開 job は事前に作成された VSIX artifact の checksum を検証し、`pnpm install --ignore-scripts` で lifecycle script を実行しない。
外部 GitHub Actions は full-length commit SHA で固定する。
