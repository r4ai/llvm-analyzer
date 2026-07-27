export {
  getCompletionItems,
  getDefinition,
  getDiagnostics,
  getDocumentSymbols,
  getFoldingRanges,
  getHover,
  getReferences,
  getRenameEdit,
  getSemanticTokens,
  makeDocumentSnapshot,
  updateDocumentSnapshot,
  semanticTokenLegend,
} from "./lsp/features.ts";
export type { DocumentSnapshot } from "./lsp/features.ts";
