# ADR 005: 明示的編集を受け取るparser session

## Status

Accepted

## Date

2026-07-27

## Supersedes

なし

## Superseded by

なし

## Context

LSPは更新範囲と置換文字列を`contentChanges`として通知する。
しかし現在のlanguage serverは更新後の全文だけをparserへ渡し、parserが更新前後の文字列比較から変更範囲を再発見している。

parserのASTはトップレベル要素ごとに独立した範囲を持つ。
一方、公開ASTは絶対位置を持つ配列であり、長さが変わる編集では後続要素の位置を移す必要がある。

## Decision Drivers

- LSPが通知した差分をparserまで失わずに渡す。
- 初回解析と更新経路の最悪計算量を文書と型から確認できるようにする。
- 局所更新と全文解析のAST、診断、意味モデルを同値にする。
- 構造境界を確定できない場合は全文解析へ戻す。
- 既存の`parseModule`契約と絶対位置のASTを維持する。

## Considered Options

### 1. 更新前後の全文比較を続ける

parserが共通接頭辞と共通接尾辞を走査し、変更範囲を推定する。

得るもの:

- 呼び出し側は更新後の全文だけを渡せばよい。
- LSP以外の呼び出し側でも局所更新を試せる。

失うもの:

- 一文字編集でも変更範囲の発見に`O(n)`時間がかかる。
- LSPが持つ変更範囲を捨てた後で同じ情報を再計算する。

### 2. 明示的編集を受け取る不変parser session

sessionが元ソースと構文解析結果を所有し、更新前の範囲と挿入後の終端位置を受け取る。
対象要素を二分探索し、安全な場合だけ局所再パースする。

得るもの:

- 対象要素の探索を`O(log m)`にできる。
- 変更範囲を再発見する全文走査を更新経路から除ける。
- 更新戦略と再パース量を観測できる。
- sessionが不変なので、古いLSPスナップショットと状態を共有しない。

失うもの:

- 呼び出し側は更新前の位置と挿入後の終端位置を正確に渡す必要がある。
- 公開AST配列の再構成に`O(m)`が残る。
- 長さが変わる場合は後続ASTの位置移動に`O(a_s)`がかかる。

### 3. 相対位置green treeと永続rope

ソースをrope、構文木を相対位置のgreen treeとして保持し、編集経路だけを永続的に置換する。

得るもの:

- AST配列の再構成と後続絶対位置の即時移動を避けられる。
- 局所編集を変更範囲と木の高さに近い計算量で扱える。

失うもの:

- parser、analyzer、全LSP変換の位置契約を同時に変更する必要がある。
- 現在の`Range`を読む既存利用箇所とテストを全面的に移行する必要がある。
- 意味モデルは依然としてモジュール全体を再リンクするため、今回のUXボトルネックに対して変更範囲が広すぎる。

## Decision

明示的編集を受け取る不変parser sessionを採用する。
LSPの差分情報を保持したまま対象要素を二分探索でき、既存のASTと意味契約を維持できるためである。

全文比較を使う既存関数は互換入口として残す。
language serverと性能ベンチマークは明示的編集の入口を使い、通常更新の計算量から全文比較を除く。

## Consequences

良い影響:

- 通常編集では変更範囲の発見にソース全体を走査しない。
- parserの初回、局所、伸縮、fallbackの計算量を入力変数ごとに説明できる。
- 更新戦略と再パースbyte数をテストとベンチマークで確認できる。

悪い影響:

- LSPのdebounce中に届く変更列をバージョン順に保持する状態が増える。
- 絶対位置ASTを維持する限り、公開Moduleの配列再構成と後続位置移動は残る。

中立的な影響:

- 境界を破壊する入力途中の編集は、従来どおり全文解析へ戻る。
- 相対位置green treeは、意味モデルも断片化するときに改めて検討する。

## Scope

parserの更新API、language serverのopen document変更経路、巨大IRベンチマークに適用する。
workspace上の未openファイル、外部LLVM verifier、formatterには適用しない。

## Follow-up

- parser sessionと明示的編集型を実装する。
- language serverの`contentChanges`をparser sessionへ渡す。
- 計算量契約、更新戦略、fallback条件を設計文書へ反映する。
- 差分結果と全文解析の同値性を継続検査する。

## References

- [プラン035](../plans/035-incremental-parser-session.md)
- [ADR 003](003-incremental-document-analysis.md)
- [ADR 004](004-defer-derived-type-inference.md)
