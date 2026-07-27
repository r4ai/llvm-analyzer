export { analyze } from "./semantic/analyzer.ts";
export { formatControlFlowGraphAsMermaid } from "./semantic/control-flow.ts";
export { attributeDocs, opcodeDocs, typeDocs } from "./semantic/docs.ts";
export { collectFileReferenceCandidates } from "./semantic/file-references.ts";
export type {
  AnalyzeOptions,
  AnalyzerDiagnostic,
  AnalyzerDiagnosticCode,
  ControlFlowBlock,
  ControlFlowEdge,
  ControlFlowGraph,
  DirectCall,
  DocumentSymbol,
  SemanticModel,
  SemanticOccurrence,
  SemanticSymbol,
  SymbolId,
  SymbolKind,
} from "./semantic/types.ts";
export type { FileReferenceCandidate, FileReferenceSource } from "./semantic/file-references.ts";
