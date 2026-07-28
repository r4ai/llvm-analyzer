# ADR 008: スナップショット派生索引の要求時最新化

## Status

Accepted

## Date

2026-07-28

## Supersedes

なし

## Superseded by

なし

## Context

解析済み`DocumentSnapshot`上のDefinition、Hover、Referencesは、位置索引によって巨大LLVM IRでも短時間で完了する。
しかし、最新snapshotを生成するサーバー経路は、Definitionが使わないWorkspace Symbols、Call Hierarchy、Rename／Quick Fix用索引まで同期構築してから結果を返している。
そのため、Cmd+クリックの待ち時間はDefinitionではなく、同じsnapshotから派生する無関係な索引のfan-outに支配される。

open documentのsnapshotは最新テキストと一致しなければならない。
一方、派生索引は利用するアクションの直前に最新化すれば結果契約を満たせる。
古いsnapshotから結果を返すこと、名前解決を簡略化すること、LSPの返却件数を減らすことは非目標とする。

## Decision Drivers

- Definition、Hover、Referencesなどの位置操作を、無関係な派生索引の構築時間から分離する。
- 各アクションは要求時点の最新テキストに対する結果を返す。
- parserとanalyzerを唯一の意味解析経路として維持し、簡易scannerとの意味差分を作らない。
- worker境界を越える巨大ASTの複製やキャンセル制御を、効果測定なしに導入しない。
- 不変snapshotを共有する既存設計と、ファイル単位の索引削除契約を維持する。

## Considered Options

### 1. 全派生索引をsnapshot生成時に同期更新する

`DocumentSnapshot`の生成直後に、すべての派生索引を最新化する。

得るもの:

- どのアクションも追加の最新化処理なしで実行できる。
- 索引の更新順序が単純になる。

失うもの:

- DefinitionがWorkspace Symbols、Call Hierarchy、Rename／Quick Fix用索引を待つ。
- 派生機能を追加するほど、すべての位置操作の初回待ち時間が増える。
- 利用されないアクションの索引にもCPU時間とメモリを使う。

### 2. snapshotを中核と派生索引に分け、要求時に最新化する

parserとanalyzer済みの不変snapshotだけを同期生成し、派生索引は利用するアクションの直前に同じsnapshotから最新化する。

得るもの:

- Definition、Hover、Referencesの待ち時間を、中核snapshotの生成時間だけに限定できる。
- 派生索引ごとに初回コスト、再利用、破棄を独立して測定できる。
- 利用されない派生索引を構築しない。

失うもの:

- 派生索引ごとに最新versionを追跡する必要がある。
- Workspace SymbolsやCall Hierarchyの初回要求へ、その索引固有の更新時間が移る。
- 新しい派生索引を追加するとき、どの要求で最新化するかを明示する必要がある。

### 3. worker threadで全文解析と全派生索引を構築する

parser、analyzer、派生索引構築をworker threadへ移し、Language Serverのイベントループを空ける。

得るもの:

- 解析中もLanguage Serverがキャンセルや別要求を処理できる。
- 複数CPU coreを利用できる余地がある。

失うもの:

- 巨大ASTと意味モデルをworker境界で複製または再表現する必要がある。
- version、キャンセル、worker障害、終了処理の状態が増える。
- Definitionは正確な最新結果を待つため、単一要求の解析レイテンシ自体は必ずしも短くならない。
- 現時点の計測では、不要な派生索引とlexerの共通経路を先に除く余地がある。

## Decision

`DocumentSnapshot`を正確性の中核として同期生成し、Workspace Symbols、Call Hierarchy、Rename／Quick Fixなどの派生索引は要求時に同じsnapshotから最新化する。
派生索引はURIとsnapshot versionで冪等にし、Definition経路では更新しない。
workspace初期走査はファイル間でイベントループへ制御を返し、open documentの要求を連続する別ファイル解析の後ろへ閉じ込めない。

worker threadは、派生索引分離と共通lexer改善後も単一ファイルの中核snapshotがUX上限を超える証拠が残った場合の後続判断とする。

## Consequences

良い影響:

- Cmd+クリックはWorkspace Symbols、Call Hierarchy、Rename／Quick Fix用索引を待たない。
- 各派生アクションの初回コストを、そのアクションの性能契約として個別に計測できる。
- 新しい派生機能がDefinitionの待ち時間を暗黙に増やしにくい。
- workspace初期走査中もファイル間でLSP要求を処理できる。

悪い影響:

- 派生索引の保留snapshotと適用versionを管理する状態が増える。
- Workspace SymbolsとCall Hierarchyの初回要求は、保留分の最新化時間を負担する。
- 派生索引を使う新しい要求は、最新化の配線と状態遷移テストが必要になる。

中立的な影響:

- parserとanalyzerの意味規則、LSPの結果件数、既存の不変snapshot契約は変えない。
- worker thread導入の可否は、今回の変更後の単一ファイル計測から改めて判断する。

## Scope

open documentのLanguage Server要求、Workspace Symbols、Call Hierarchy、Rename／Quick Fix用名前索引、workspace初期走査へ適用する。
外部LLVM verifier、閉じたファイルの永続索引、複数プロセスでの索引共有には適用しない。

## Follow-up

- 派生索引の保留、URI単位の最新化、削除を古典派テストで検証する。
- 初回Definitionと派生索引fan-outを分離した性能シナリオをCIへ追加する。
- `docs/design.md`と`docs/architecture.md`へ現在設計を反映する。
- 改善後も中核snapshotがUX上限を超える入力規模を測定し、worker threadの再検討条件を記録する。

## References

- [巨大LLVM IRの対話レイテンシ](../plans/039-large-ir-interactive-latency.md)
- [巨大LLVM IRのコードナビゲーション待ち時間](../plans/038-navigation-snapshot-latency.md)
- [不変snapshotの言語機能索引](007-index-immutable-language-actions.md)
- [現在の設計](../design.md)
