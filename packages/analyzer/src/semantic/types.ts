import type { IdentifierRef, Position, Range } from "@llvm-analyzer/parser";

/** 意味解析のオプション。 */
export interface AnalyzeOptions {
  /** 型推定に使う元ソース。省略時は型が取れる範囲だけ解決する。 */
  readonly source?: string;
  /** 未定義参照の診断を出すか。既定は true。 */
  readonly reportUndefinedReferences?: boolean;
}

/** シンボル ID。解析ごとに安定した文字列を割り当てる。 */
export type SymbolId = string;

/** 意味シンボルの種別。 */
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

/** 意味シンボル。 */
export interface SemanticSymbol {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly scopeId: string;
  readonly scopeName: string;
  readonly definition: IdentifierRef;
  readonly references: readonly IdentifierRef[];
  readonly type?: string;
}

/** analyzer が出す診断コード。 */
export type AnalyzerDiagnosticCode = "duplicate-definition" | "undefined-reference";

/** 意味診断。 */
export interface AnalyzerDiagnostic {
  readonly code: AnalyzerDiagnosticCode;
  readonly range: Range;
  readonly message: string;
  readonly severity: "error" | "warning";
}

/** LSP documentSymbol へ写像しやすい階層シンボル。 */
export interface DocumentSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly range: Range;
  readonly selectionRange: Range;
  readonly children?: readonly DocumentSymbol[];
}

/** 解析済み意味モデル。 */
export interface SemanticModel {
  readonly symbols: readonly SemanticSymbol[];
  symbolAt(position: Position): SemanticSymbol | undefined;
  definitionAt(position: Position): SemanticSymbol | undefined;
  referencesOf(symbolId: SymbolId): readonly IdentifierRef[];
  documentSymbols(): readonly DocumentSymbol[];
  diagnostics(): readonly AnalyzerDiagnostic[];
}
