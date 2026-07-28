# 初回Definitionのトークン割り当て削減

## Context

巨大LLVM IRの解析済みsnapshotではDefinition本体は0.1 ms未満で完了する。
一方、約1.58 MB、1,600関数、64,000命令の初回snapshotは今回の再計測で112.6 ms、約6.3 MB、256,000命令では453.3 msを要した。
初回Definitionの待ち時間は、Definition検索ではなく最新snapshotの構築時間に支配されている。

同じ約1.58 MB入力をフェーズ別に測ると、公開`tokenize`が42.9 ms、`parseModule`全体が86.0 ms、`analyze`が34.6 ms、`TextDocument`の行位置表が2.0 ms、Definition本体が0.1 ms未満だった。
`parseModule`だけを20回実行したCPUプロファイルでは、1,324サンプル中530サンプル、約40%をGCが占めた。
現在のlexerは約47万トークンそれぞれに`Token`、`Range`、開始`Position`、終了`Position`を割り当てるが、parserはASTへ必要なrangeだけを転記したあと、トークン列全体を破棄する。

公開`tokenize(source): Token[]`のLSP互換range契約は維持する。
parser内部だけが使う軽量表現を追加し、字句規則を複製せずに一回の走査から必要な表現を生成する。
設計判断は[ADR 009](../adr/009-separate-parser-token-representation.md)へ記録する。

## スコープ

今回行うことは次のとおり。

- 初回Definitionをlexer、parser、analyzer、行位置表、Definition本体へ分解して継続計測する。
- parser専用トークンを、値と位置のプリミティブ値を持つ単一オブジェクトへ変更する。
- 公開`tokenize`とparser専用トークンが同じscannerを共有し、字句規則の分岐を一箇所に保つ。
- parserがAST、診断、range、エラー回復の既存契約を維持することを古典派テストで確認する。
- 約1.58 MBと約6.3 MBの初回Definitionを再計測し、入力4倍時の正規化増加率と絶対上限をCIで検査する。
- 変更後も最大のCPU要因を再計測し、同じ設計範囲で安全に除ける割り当てや全文走査があれば追加で改善する。

今回行わないことは次のとおり。

- 公開`Token`、AST、意味モデル、LSP応答の型や結果件数を変更しない。
- 正確性を落とす簡易Definition scannerや古いsnapshotを導入しない。
- 単一要求の処理時間を短縮しないworker threadへ先に移行しない。
- parserと公開lexerで字句規則を複製しない。

## Red

現在の約6.3 MB初回Definitionは453.3 msである。
性能ゲートへフェーズ別計測と、約1.58 MBから約6.3 MBへの4倍入力で正規化した増加率上限1.3を追加する。
約6.3 MB入力は一回のGC停止で30 ms以上揺れたため、3サンプルから5サンプルへ増やした中央値で判定する。
絶対時間だけでなく約1.58 MBから約6.3 MBへの4倍入力で正規化した増加率も検査し、局所的な定数改善で二次経路を隠さない。

公開lexerとparserの結果契約は、次の状態表からテストする。

| 入力状態                 | 公開lexer                     | parser                                 |
| ------------------------ | ----------------------------- | -------------------------------------- |
| 空入力                   | ゼロ幅`Eof`と完全なrange      | 空Moduleとゼロ幅range                  |
| 複数行の正常IR           | 全Tokenの値と行・桁が正しい   | ASTと識別子rangeが従来結果と一致       |
| コメントを含むIR         | Commentを返す                 | Commentを除外して同じASTを返す         |
| 未終端文字列・未知文字   | 回復Tokenを返す               | 診断を返し、後続エントリの解析を続ける |
| 数値・quoted識別子・改行 | 境界Tokenの半開区間を維持する | Definitionが同じ定義rangeへ解決される  |

## Green

scannerは開始・終了のoffset、line、columnをプリミティブ値としてemit先へ渡す。
公開`tokenize`はその場で既存`Token`を生成し、parser入口は同じ情報から軽量トークンだけを生成する。
parserがASTへrangeを保存する地点でのみ`Range`と`Position`を具体化する。

## Refactoring

- parser内のrange変換を少数のhelperへ集約する。
- scannerの字句状態遷移と表現生成を分離し、公開契約と内部最適化の責務を混ぜない。
- 変更後のCPUプロファイルでGC比率と次のホット関数を再確認する。
- parser内部の配列複製が次の支配要因になった場合だけ、今回の契約内で追加の一回走査へ置き換える。

## 検証方法

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

変更前後はNode.js 26.1.0、同じ合成IR、5サンプル中央値で比較する。
CPUプロファイルは約1.58 MB入力の`parseModule`を20回実行し、GCと関数別self sampleを比較する。

## 実装結果

公開`tokenize`とparser専用Tokenが一つのscannerを共有する構成へ変更した。
公開入口は従来どおり完全な`Token`と`range`を生成する。
parser入口はコメントを生成時に除外し、開始位置と値を単一オブジェクトへ保持する。
単一行Tokenの終了offset、line、columnは開始位置と値の長さから導出し、複数行Tokenだけが終了行と終了桁を追加で持つ。

parserは識別子、命令、AST要素へ保存する地点だけで`Range`と`Position`を具体化する。
参照を持たない命令は空の不変配列を共有し、単一行要素の収集で中間配列を二重生成しない。
意味モデルは`SymbolId`の文字列型と単一解析結果内の一意性を維持しつつ、scope名とsymbol名を重ねた長いIDからbase36の登録順IDへ変更した。

### 性能

Node.js 26.1.0、同じ合成IR、5サンプル中央値で測定した。

| シナリオ                                        |   変更前 |   変更後 | 改善率 |
| ----------------------------------------------- | -------: | -------: | -----: |
| 約1.58 MB、64,000命令の初回snapshotとDefinition | 112.6 ms |  84.1 ms |  25.3% |
| 約6.3 MB、256,000命令の初回Definition           | 461.7 ms | 349.0 ms |  24.4% |
| 約1.58 MBの`parseModule`                        |  86.0 ms |  41.8 ms |  51.4% |

約1.58 MBの`parseModule`を20回実行したCPUプロファイルでは、総サンプルが1,324から719へ45.7%減った。
GCサンプルは530から162へ69.4%減り、全体に占める比率は40.0%から22.5%へ低下した。
解析済みsnapshot上のDefinitionは引き続き0.1 ms未満であり、結果契約と問い合わせ時間は変えていない。

約6.3 MB入力は一回のGC停止で30 ms以上揺れたため、性能ゲートを3サンプルから5サンプルの中央値へ変更した。
約1.58 MBの既存絶対上限500 msと、約6.3 MBまで入力を4倍にしたときの正規化増加率上限1.3を併用する。

GitHub Ubuntu runnerでの3回の測定では、約1.58 MB初回snapshotが211.7〜230.5 ms、約6.3 MB初回Definitionが913.6〜970.7 msだった。
絶対値には6〜9%の実行間変動があったが、同じrunner・同じ実行内で求めた入力4倍時の正規化増加率は1.0〜1.2だった。
6.3 MBだけにrunner固有の絶対上限を置かず、この比率で実行環境の速度差を相殺しながら線形契約を検査する。
CIは`ubuntu-24.04`へ固定し、`ubuntu-latest`の移行によるOSイメージ世代の変化を防ぐ。
GitHub-hosted runnerは実行ごとに新しいVMとなるため、ハードウェア性能の個体差は5サンプル中央値と同一実行内の正規化比で吸収する。

Code ActionとDocument Linksは初回要求で入力全体に比例する遅延索引を構築するため、そのcold増加率だけを入力倍率4で正規化する。
再要求時間と20 msの対話操作上限は独立して検査し、CIで観測したCode Actionのcold 12.88 msを許容しつつ、UX上限の回帰を検出する。

CI再実行では数値lexerを全サンプル測った後に識別子lexerを測る順序により、後者だけがJIT最適化の恩恵を受け、比率が1.5になった。
比率上限1.4は維持し、両入力を事前に交互ウォームアップした上で、サンプルごとの先行入力も交互にするペア計測へ変更した。
