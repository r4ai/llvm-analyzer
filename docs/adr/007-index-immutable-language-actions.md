# ADR 007: 不変スナップショット上の操作索引

## Status

Accepted

## Date

2026-07-27

## Supersedes

なし

## Superseded by

なし

## Context

初回解析と差分解析は入力サイズに対して線形化されている。
しかし、LSP操作の一部は解析済みモデルを受け取った後に参照列を再整列し、全シンボルまたは全関数を走査していた。

Language Serverの`DocumentSnapshot`は文書バージョンごとに不変である。
同じスナップショットへの問い合わせ結果は変わらないため、位置索引と導出結果を再利用できる。

VSCode拡張のCFG commandだけはLanguage Serverのスナップショットを使わず、拡張ホストで全文を再解析していた。
巨大IRでは、この経路が一回のcommandごとに初回解析相当の待ち時間を発生させる。

## Decision Drivers

- 結果件数が一定の位置問い合わせを文書全体の大きさから切り離す。
- 返却件数が多い操作は、入力と出力に対する線形時間を超えないようにする。
- 名前解決、参照順、Workspace Symbolの部分一致、Call Hierarchyの既存結果を維持する。
- parserとanalyzerの純粋性、および`DocumentSnapshot`の不変性を維持する。
- キャッシュの失効条件を文書バージョンの置換へ一本化する。

## Considered Options

### 1. 操作ごとに既存配列を走査する

各LSP handlerが`SemanticModel.symbols`、参照列、関数列から必要な結果を作る。

得るもの:

- 追加の索引とキャッシュを持たない。
- 各handlerだけを読めば変換処理を追える。

失うもの:

- 表示範囲だけのInlay Hints、位置指定のCFG、完全一致に近いWorkspace Symbol検索でも文書全体を走査する。
- Semantic TokensやDocument Symbolsを同じ文書バージョンで再要求するたびに同じ配列を構築する。
- CFG commandは拡張ホストで全文解析を繰り返す。

### 2. 可変の共有キャッシュを操作ごとに失効させる

Language Server全体に操作結果キャッシュを置き、文書変更時に関連キーを削除する。

得るもの:

- 既存の`DocumentSnapshot`型を変更せずに結果を再利用できる。
- 操作ごとに異なる有効期間を設定できる。

失うもの:

- 文書変更、close、watched file更新ごとに複数キャッシュの失効順序を管理する必要がある。
- 古い解析結果と新しいテキストを組み合わせる状態を表現できてしまう。
- キャッシュキーと文書バージョンの不変条件が各操作へ分散する。

### 3. 不変スナップショットに対応する索引と導出結果

analyzerは出現、定義範囲、可視スコープ、関数範囲をソース順索引として公開する。
Language ServerはWorkspace Symbolの三文字索引、Call Hierarchyのcallerとcallee索引、安全な置換候補の長さ索引をスナップショット登録時に作る。
全件を返す不変結果はスナップショットをキーに再利用する。
CFG commandは独自LSP requestで同じスナップショットへ問い合わせる。

得るもの:

- 位置問い合わせを二分探索または索引参照にできる。
- 範囲問い合わせは範囲内の結果だけを評価できる。
- キャッシュはスナップショットが参照されなくなれば`WeakMap`から回収でき、個別の失効処理を持たない。
- CFG commandが解析と索引をLanguage Serverの他機能と共有する。

失うもの:

- 文書バージョンごとに索引のメモリを追加で使う。
- 初回解析時に行位置表と置換候補索引を準備する線形時間が増える。
- 独自LSP requestの入力検証とクライアント接続を保守する必要がある。

## Decision

不変スナップショットに対応する索引と導出結果を採用する。
操作ごとの可変な失効状態を増やさず、既存の文書バージョン境界だけで結果の整合性を保証できるためである。

結果件数が一定の操作は、出現、定義範囲、関数範囲、名前の各索引を使う。
References、Rename、Semantic Tokensのように結果自体が大きい操作はソース順の既存配列を再整列せずに変換する。

Document Symbols、Semantic Tokens、Folding Ranges、Document Link候補は同じスナップショット内で再利用する。
外部から届くCFG requestはLanguage Server境界で検証し、不正入力と関数外位置では結果なしを返す。

## Consequences

良い影響:

- Definition、Hover、表示範囲Inlay Hints、Range Formatting、CFG、完全一致に近いWorkspace Symbol検索が文書全体を走査しない。
- ReferencesとRenameは参照列を再整列しない。
- Workspace SymbolとCall Hierarchyは登録時に作った索引を問い合わせで共有する。
- CFG commandは拡張ホストでparserとanalyzerを再実行しない。

悪い影響:

- 初回解析は行位置表と置換候補索引の構築コストを含む。
- Workspace Symbolの三文字索引とCall Hierarchy索引が追加メモリを使う。
- キャッシュしたLSP結果を変更しないという呼び出し側の前提が増える。

中立的な影響:

- 全文Formatting、Semantic Tokensの初回生成、全参照Renameは返却量に比例する処理を残す。
- 3文字未満のWorkspace Symbol queryは候補を十分に絞れないため、全索引を走査する。
- 文書更新では新しいスナップショットと索引を作り、古い結果を部分更新しない。

## Scope

analyzerの問い合わせAPI、Language Serverの文書操作、Workspace Symbols、Call Hierarchy、Document Links、VSCode拡張のCFG commandに適用する。
parserの構文解析規則、外部LLVM verifier、ワークスペースファイル走査には適用しない。

## Follow-up

- 操作別の初回時間と再要求時間を巨大IRベンチマークで継続検査する。
- 索引の計算量契約を設計文書へ反映する。
- 返却件数またはメモリ使用量が問題になった場合は、LSP標準の部分結果対応を別の判断として検討する。

## References

- [プラン037](../plans/037-large-ir-action-performance.md)
- [ADR 002](002-avoid-quadratic-full-document-analysis.md)
- [ADR 003](003-incremental-document-analysis.md)
- [ADR 004](004-defer-derived-type-inference.md)
