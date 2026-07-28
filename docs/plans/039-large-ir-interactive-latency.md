# 巨大LLVM IRの対話レイテンシ

## Context

巨大LLVM IRでは、解析済みスナップショット上のDefinitionやReferencesは十分に速い。
一方、ファイルを開いた直後や編集直後のCmd+クリックでは、最新スナップショットを同期生成する待ち時間が残る。
`origin/main`の約1.58 MB、1,600関数、64,000命令の合成IRでは、初回snapshotとDefinitionが114.8 ms、局所編集後が33.1 msだった。
実ファイルがさらに大きい場合やLanguage Serverがworkspace索引を同時更新する場合、この線形コストが知覚可能な待ち時間へ増える。

既存実装には、Definitionでは使わないRename／Quick Fix用の名前索引をsnapshot生成時に構築する経路も残っている。
初回読み込みとコードジャンプに必要な必須処理を明確にし、派生索引の構築を利用アクションへ移す。
そのうえでparser、analyzer、workspace索引登録を個別に計測し、必要ならスナップショットの責務境界を見直す。

## スコープ

今回行うことは次のとおり。

- 初回読み込み、初回Definition、初回References、局所編集直後のDefinitionを別々に計測する。
- snapshot生成時のparser、analyzer、TextDocument行索引、workspace索引登録の時間を分離する。
- Definitionに不要な派生索引を要求時構築へ移す。
- レジスタのDefinition／Referencesが最新テキストとスコープ規則を維持することを古典派テストで確認する。
- 巨大IRの絶対時間、入力4倍時の正規化増加率、編集後の高速化率をCI性能ゲートにする。
- ボトルネックがsnapshotの責務分離を必要とする場合はADRを作成する。

今回行わないことは次のとおり。

- LSPの返却件数、検索範囲、名前解決規則を変えない。
- 古いsnapshotからDefinitionやReferencesを返さない。
- 正確性を落とす正規表現ベースの簡易ナビゲーションを追加しない。
- 性能測定なしにworker threadや独自キャッシュ層を追加しない。

## 検証方法

状態と操作の組合せを次のように検証する。

| 状態                     | 操作                          | 結果契約                         | 性能契約                                   |
| ------------------------ | ----------------------------- | -------------------------------- | ------------------------------------------ |
| 未解析の巨大IR           | 初回Definition                | 最新テキストのレジスタ定義を返す | 必須snapshot生成以外の派生索引を構築しない |
| 解析済み巨大IR           | Definition、Hover             | 同じ定義位置と内容を返す         | 問い合わせは入力サイズに依存しない         |
| 単一レジスタへの大量参照 | References、Rename            | 宣言指定と全出現順を維持する     | 出力件数に対して線形                       |
| 単一関数内を編集         | Definition、References        | 編集後の定義と参照を返す         | 全体再構築より速い                         |
| 派生索引未構築           | Rename、Quick Fix、Completion | 従来と同じ候補を返す             | 最初の利用時だけ構築する                   |
| workspace索引更新中      | 開いている文書のDefinition    | open documentを優先する          | 無関係なファイル解析を直列待ちしない       |

次のコマンドを実行する。

```sh
pnpm benchmark:large-ir -- --check
pnpm test:coverage
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm --filter llvm-analyzer-vscode test:e2e
pnpm changeset status --since=origin/main
```

変更前後は同じNode.js、同じ入力、同じサンプル数で比較する。
短時間操作はノイズ床と絶対上限を併用し、初回読み込みはparser、analyzer、索引登録を分けて報告する。

## 実装結果

`DocumentSnapshot`をDefinition、Hover、Referencesが共有する中核状態とし、Workspace SymbolsとCall Hierarchyの派生索引はURI単位で保留する`SnapshotDerivedIndexes`へ分離した。
派生索引を使う要求の直前にだけ同じversionのsnapshotを反映し、新しいversionの後から届いた古いsnapshotは無視する。
Rename／Quick Fix用の置換候補索引、CFG、直接呼び出し列も対応するアクションの初回要求まで構築しない。

ファイルopen時は中核snapshotを即時生成する。
診断の150 ms debounceは維持するが、初回Definition、Hover、Referencesの準備開始を遅らせない。
編集時は従来どおりdebounceと明示的な差分範囲を使い、入力中の再解析回数を増やさない。

workspace初期走査は最大4件のファイル読み込みを並行し、各同期解析の前にイベントループへ制御を返す。
総索引時間を直列I/Oで延ばさず、連続する別ファイル解析の間でopen documentのLSP要求を処理できる。

lexerは一般的な10進整数と浮動小数を正規表現なしの前方向走査へ移した。
16進float、NaN payload、正確な浮動小数ビット列などの低頻度構文だけを接頭辞で選んだ正規表現へ渡す。
既存の正当・不正数値境界を含むトークン列とrange契約は維持した。

### 性能

Node.js 26.1.0で5サンプルの中央値を測定した。

| シナリオ                                        |          `origin/main` |                         変更後 |
| ----------------------------------------------- | ---------------------: | -----------------------------: |
| 約1.58 MB、64,000命令の初回snapshotとDefinition |               114.8 ms |                        99.1 ms |
| 同じ入力の局所編集後snapshotとDefinition        |                33.1 ms |                        31.7 ms |
| 約6.3 MB、256,000命令の初回Definition           |                 未計測 |                       413.5 ms |
| 派生索引の要求時構築                            | Definition前に同期実行 | 1.7 msをDefinition経路から分離 |
| 数値中心lexer / 識別子中心lexer                 |             1.6倍でRed |                          1.0倍 |

約1.58 MBの解析済みsnapshotでは、Definitionは初回0.012 ms、Referencesは16,001件で初回1.166 ms、Renameは16,001件で初回0.902 msだった。
結果件数が一定の全対話操作は20 ms未満、全件操作の初回生成は100 ms未満だった。
約6.3 MBの初回Definitionが500 ms未満だったため、ASTと意味モデルのworker境界複製は今回導入しなかった。

### 検証

- `pnpm test:coverage`: 388件成功、statement、branch、function、lineが100%。
- `pnpm typecheck`、`pnpm lint`、`pnpm format`、`pnpm build`: 成功。
- `pnpm benchmark:large-ir -- --check`: 数値lexer、4倍入力の正規化増加率、初回・編集後Definition、派生索引分離、約6.3 MB入力、全LSP操作を含めて成功。
- `pnpm --filter llvm-analyzer-vscode test:e2e`: VSCode 1.96.0 Extension Hostで9件成功。
