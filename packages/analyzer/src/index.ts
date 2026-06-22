export { analyze } from "./semantic/analyzer.ts";
export { opcodeDocs, typeDocs } from "./semantic/docs.ts";
export { collectFileReferenceCandidates } from "./semantic/file-references.ts";
export type {
  AnalyzeOptions,
  AnalyzerDiagnostic,
  AnalyzerDiagnosticCode,
  DirectCall,
  DocumentSymbol,
  SemanticModel,
  SemanticSymbol,
  SymbolId,
  SymbolKind,
} from "./semantic/types.ts";
export type { FileReferenceCandidate, FileReferenceSource } from "./semantic/file-references.ts";
