/**
 * analyzer が公開する意味モデルの型定義。
 *
 * parser の AST は「どの識別子がどこに現れたか」までを表し、識別子同士の対応関係は持たない。
 * analyzer はその AST から、LSP の definition / references / documentSymbol / diagnostics にそのまま渡せる
 * シンボル表と参照インデックスを構築する。
 */
import type { IdentifierRef, Position, Range } from "@llvm-analyzer/parser";

/**
 * 意味解析のオプション。
 *
 * @remarks
 * analyzer は AST だけでも定義参照インデックスを構築できる。
 * ただし parser は命令内部の型構文を構造化しないため、SSA 値の型推定には元ソース文字列が必要になる。
 *
 * @example
 * const { ast } = parseModule(source);
 * const model = analyze(ast, { source, reportUndefinedReferences: true });
 */
export interface AnalyzeOptions {
  /**
   * 型推定に使う元ソース。
   *
   * 省略すると、関数引数と命令結果の型は `undefined` になることがある。
   * 位置情報は AST の `range` を使うため、渡す文字列は `parseModule` に渡したものと同一でなければならない。
   *
   * @see {@link SemanticSymbol.type}
   */
  readonly source?: string;
  /**
   * 未定義参照の診断を出すか。
   *
   * 補完や入力途中の軽い解析で診断だけ抑止したい場合に false を指定する。
   * 既定値は true。
   *
   * @defaultValue true
   */
  readonly reportUndefinedReferences?: boolean;
}

/**
 * 意味シンボルを一意に識別する ID。
 *
 * @remarks
 * ID は単一の解析結果内で安定する。
 * ソース編集後に再解析した場合、同じ名前でも別の ID になる可能性がある。
 */
export type SymbolId = string;

/**
 * 意味シンボルの種別。
 *
 * @remarks
 * モジュールスコープの `@` グローバル、名前付き型、メタデータ、属性グループと、
 * 関数スコープの引数、SSA ローカル値、ラベルを区別する。
 */
export type SymbolKind =
  | "global"
  | "function"
  | "type"
  | "metadata"
  | "attributeGroup"
  | "comdat"
  | "parameter"
  | "local"
  | "label";

/**
 * 定義済みの名前と、その名前へ解決された参照列。
 *
 * @remarks
 * `definition` は名前を導入した出現を指す。
 * `references` には定義位置自身も含める。
 * これにより Find References で「宣言を含める」挙動を追加処理なしで実装できる。
 *
 * @see {@link SemanticModel.referencesOf}
 */
export interface SemanticSymbol {
  /** 解析結果内で一意な ID。 */
  readonly id: SymbolId;
  /** 接頭辞を含む生テキスト。ラベルだけは `%exit` ではなく `exit` で保持する。 */
  readonly name: string;
  /** シンボルの分類。LSP の SymbolKind へ写像する入力になる。 */
  readonly kind: SymbolKind;
  /** 所属スコープの ID。モジュールスコープは `module`。 */
  readonly scopeId: string;
  /** 表示用の所属スコープ名。関数スコープでは関数名になる。 */
  readonly scopeName: string;
  /** シンボルを導入した識別子出現。 */
  readonly definition: IdentifierRef;
  /** 定義位置を含む全出現。ソース順に並ぶ。 */
  readonly references: readonly IdentifierRef[];
  /**
   * 推定できた LLVM IR 型。
   *
   * @remarks
   * 型推定は `AnalyzeOptions.source` が渡され、かつ単純な `i32 %x` や `add i32` のような形を読める場合に限る。
   * 未推定なら undefined。
   */
  readonly type?: string;
}

/** analyzer が出す診断コード。 */
export type AnalyzerDiagnosticCode =
  | "duplicate-definition"
  | "undefined-reference"
  | "self-reference-before-definition"
  | "instruction-after-terminator";

/**
 * 意味解析で検出した診断。
 *
 * @remarks
 * 構文診断は parser が返すため、この型は名前解決とスコープ規則に関する診断だけを表す。
 */
export interface AnalyzerDiagnostic {
  /** 機械的に分岐しやすい診断コード。 */
  readonly code: AnalyzerDiagnosticCode;
  /** 診断対象のソース範囲。 */
  readonly range: Range;
  /** ユーザーへ表示する日本語メッセージ。 */
  readonly message: string;
  /** LSP の DiagnosticSeverity へ写像する重大度。 */
  readonly severity: "error" | "warning";
}

/**
 * LSP documentSymbol へ写像しやすい階層シンボル。
 *
 * @remarks
 * トップレベル定義を親にし、関数定義の子として引数、ラベル、SSA ローカル値を並べる。
 *
 * @see {@link SemanticModel.documentSymbols}
 */
export interface DocumentSymbol {
  /** アウトラインに表示する名前。 */
  readonly name: string;
  /** analyzer 内部のシンボル種別。 */
  readonly kind: SymbolKind;
  /** ノード全体の範囲。トップレベルではエントリ全体、子要素では定義名の範囲。 */
  readonly range: Range;
  /** 選択対象の範囲。通常は名前そのものの範囲。 */
  readonly selectionRange: Range;
  /** 関数定義に属する子シンボル。無い場合は undefined。 */
  readonly children?: readonly DocumentSymbol[];
}

/**
 * 解析済み意味モデル。
 *
 * @remarks
 * このオブジェクトは不変の問い合わせ API として扱う。
 * LSP アダプタはドキュメント更新ごとに作り直し、古いモデルを破棄する想定。
 *
 * @example
 * const { ast } = parseModule(source);
 * const model = analyze(ast, { source });
 * const symbol = model.symbolAt(position);
 */
export interface SemanticModel {
  /** 解析で見つかった全シンボル。登録順はソース上の定義順。 */
  readonly symbols: readonly SemanticSymbol[];
  /**
   * 指定位置にある識別子へ解決済みのシンボルを返す。
   *
   * @param position 照会するソース位置。offset/line/column は parser と同じ 0 始まり。
   * @returns 位置が解決済み識別子上にあれば対応するシンボル。範囲外または未定義参照なら undefined。
   *
   * @remarks
   * 識別子の範囲外、または未定義参照の位置では undefined を返す。
   */
  symbolAt(position: Position): SemanticSymbol | undefined;
  /**
   * 指定位置にある識別子の定義シンボルを返す。
   *
   * @param position 定義元を探すソース位置。
   * @returns 定義へ解決できたシンボル。未定義参照または識別子外なら undefined。
   *
   * @remarks
   * 現状は `symbolAt` と同じシンボルを返す。
   * LSP アダプタは戻り値の `definition.range` を DefinitionLocation に変換する。
   */
  definitionAt(position: Position): SemanticSymbol | undefined;
  /**
   * 指定シンボルの全参照をソース順で返す。
   *
   * @param symbolId `SemanticSymbol.id` から取得したシンボル ID。
   * @returns 定義位置を含む参照列。未知の ID では空配列。
   *
   * @remarks
   * 戻り値には定義位置自身も含まれる。
   * 未知の ID では空配列を返す。
   */
  referencesOf(symbolId: SymbolId): readonly IdentifierRef[];
  /**
   * ドキュメントアウトライン向けの階層シンボルを返す。
   *
   * @returns トップレベル定義を親にした documentSymbol 互換の階層。
   */
  documentSymbols(): readonly DocumentSymbol[];
  /**
   * 解析時に収集した意味診断を返す。
   *
   * @returns 重複定義・未定義参照・最小限の well-formedness 診断列。
   */
  diagnostics(): readonly AnalyzerDiagnostic[];
}
