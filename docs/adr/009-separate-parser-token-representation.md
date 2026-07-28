# ADR 009: 公開lexerとparser内部トークン表現の分離

## Status

Accepted

## Date

2026-07-28

## Supersedes

なし

## Superseded by

なし

## Context

公開`tokenize(source): Token[]`は、各トークンへoffset、line、columnを持つ開始・終了`Position`と`Range`を付ける。
この表現はlexer利用者にとって扱いやすく、既存の公開契約である。

一方、`parseModule`は巨大IRの全トークンをこの公開表現で生成し、ASTへ必要な識別子とrangeを転記したあとに破棄する。
約1.58 MB入力では約47万トークンを生成し、CPUプロファイルの約40%をGCが占めた。
初回Definitionの検索自体は0.1 ms未満であり、同期snapshot構築のlexerとparserが待ち時間を決めている。

字句規則、公開Token、AST、LSPの意味契約は変更しない。
parser内部の一時表現と割り当てだけを減らす必要がある。

## Decision Drivers

- 公開`tokenize`の値、種別、完全なrange、エラー回復契約を維持する。
- parserが破棄する一時的な`Range`と`Position`の割り当てを減らす。
- 公開lexerとparserでLLVM IRの字句規則を複製しない。
- parserのAST、診断、rangeを従来結果と同一に保つ。
- 初回Definitionの単一要求レイテンシとGC時間を直接短縮する。

## Considered Options

### 1. 公開Tokenをparserでも使い続ける

公開`tokenize`の結果をそのままparserへ渡す。

得るもの:

- トークン表現と入口が一つで実装が単純になる。
- lexerの単体テストがparser入口と同じオブジェクトを直接検証する。

失うもの:

- parserが使わない入れ子の位置オブジェクトを全トークンへ割り当てる。
- 巨大IRの初回snapshotでGCが最大のCPU要因として残る。
- Definitionと無関係な公開APIの利便性が、コードジャンプ待ち時間へ常に課金される。

### 2. 字句scannerを共有し、出力表現を分ける

一つのscannerがトークン種別と位置のプリミティブ値をemitし、公開入口は既存Token、parser入口は軽量な内部Tokenを生成する。

得るもの:

- 字句規則を一箇所に保ったまま、parserの一時オブジェクト数を減らせる。
- 公開`tokenize`とASTの型を変更しない。
- parserがASTへ保存するrangeだけを具体化できる。

失うもの:

- lexerに公開表現と内部表現の二つの生成経路が生まれる。
- scannerの出力が両方で同値であることをテストする必要がある。
- parserは内部Tokenから公開`Range`を作るhelperを持つ。

### 3. parserをストリーミング構文解析へ全面変更する

トークン配列を作らず、scannerから届いたトークンを逐次ASTへ変換する。

得るもの:

- 全トークン配列の保持を避けられる可能性がある。
- 一時メモリの上限をさらに下げられる余地がある。

失うもの:

- 複数行命令、関数本体、エラー回復で現在使う先読みと部分列操作を全面的に再設計する必要がある。
- parserの状態と巻き戻し境界が増え、今回必要な割り当て削減に対して変更範囲が大きい。
- 軽量トークン分離だけでUX上限を満たせるかを先に測定できない。

### 4. 全文解析をworker threadへ移す

公開Tokenの生成とparserをworkerで実行する。

得るもの:

- 解析中もLanguage Serverのイベントループが別要求を処理できる。

失うもの:

- Definitionは最新snapshotを待つため、単一要求の完了時間を直接短縮しない。
- 巨大ASTと意味モデルの転送表現、version、キャンセル、障害処理が必要になる。
- 計測で最大だったGC割り当てはworker内に残る。

## Decision

字句scannerを共有し、公開`Token`とparser内部の軽量Tokenを別々に生成する。
scannerは種別、値、開始・終了のoffset、line、columnをプリミティブ値としてemit先へ渡す。
parser内部Tokenは位置を入れ子オブジェクトにせず保持し、ASTへ保存する地点だけで公開`Range`を生成する。

ストリーミングparserとworker threadは、軽量Tokenへ分離した後も初回DefinitionがUX上限を超え、次の計測でトークン配列保持またはイベントループ占有が支配要因になった場合に再評価する。

## Consequences

良い影響:

- parserが全トークンへ`Range`と二つの`Position`を割り当てる必要がなくなる。
- 公開lexerの契約とparserのAST契約を維持したまま、初回snapshotのGC時間を減らせる。
- 今後、内部Tokenの表現を公開APIから独立して計測、改善できる。

悪い影響:

- scannerのemit先が二種類になり、同じ入力順と位置を生成する契約テストが必要になる。
- parserは内部Token専用の型とrange変換helperへ依存する。
- 公開`tokenize`単体の割り当て量は変わらない。

中立的な影響:

- parserとanalyzerの依存方向、AST、意味規則、LSP応答は変わらない。
- 内部Tokenは`packages/parser`外へ公開しない。

## Scope

`packages/parser`の字句scanner、`parseModule`、初回および全文fallbackのsnapshot構築へ適用する。
型parser、formatter、analyzerの短い断片に対する公開`tokenize`利用は、今回の計測対象から外す。

## Follow-up

- 約1.58 MBと約6.3 MBの初回Definition、4倍入力の正規化増加率、CPUプロファイルを再計測する。
- `docs/design.md`と`docs/architecture.md`へ公開Tokenと内部Tokenの責務境界を反映する。
- parserの結果同値性と公開lexerのrange契約をカバレッジ付きテストで検証する。

## References

- [初回Definitionのトークン割り当て削減](../plans/040-first-definition-token-allocation.md)
- [巨大LLVM IRの対話レイテンシ](../plans/039-large-ir-interactive-latency.md)
- [スナップショット派生索引の要求時最新化](008-lazy-snapshot-derived-indexes.md)
- [現在の設計](../design.md)
