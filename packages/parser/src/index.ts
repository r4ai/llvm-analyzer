export { tokenize } from "./lexer/index.ts";
export type { Position, Range, Token, TokenKind } from "./lexer/index.ts";
export { parseModule } from "./parser/index.ts";
export type {
  AttributeGroupDefinition,
  BasicBlock,
  ComdatDefinition,
  DebugRecord,
  DiagnosticSeverity,
  EntryBase,
  FunctionDeclaration,
  FunctionDefinition,
  GlobalVariable,
  IdentifierRef,
  Instruction,
  MetadataDefinition,
  ModuleAsm,
  Module,
  NodeBase,
  ParseDiagnostic,
  ParseResult,
  SourceFilename,
  TargetDefinition,
  TopLevelEntry,
  TypeDefinition,
  UnknownEntry,
  UseListOrderDirective,
} from "./ast/index.ts";
