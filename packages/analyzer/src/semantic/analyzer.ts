import type {
  BasicBlock,
  FunctionDefinition,
  IdentifierRef,
  Instruction,
  Module,
  Position,
  Range,
  TopLevelEntry,
} from "@llvm-analyzer/parser";
import type {
  AnalyzeOptions,
  AnalyzerDiagnostic,
  DocumentSymbol,
  SemanticModel,
  SemanticSymbol,
  SymbolId,
  SymbolKind,
} from "./types.ts";

const MODULE_SCOPE_ID = "module";
const MODULE_SCOPE_NAME = "module";

interface MutableSymbol {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly scopeId: string;
  readonly scopeName: string;
  readonly definition: IdentifierRef;
  readonly references: IdentifierRef[];
  readonly type?: string;
}

interface Scope {
  readonly id: string;
  readonly name: string;
  readonly symbols: Map<string, MutableSymbol>;
}

interface Occurrence {
  readonly ref: IdentifierRef;
  readonly symbol: MutableSymbol;
}

const MODULE_REF_KINDS = new Set<IdentifierRef["kind"]>([
  "GlobalRef",
  "MetadataRef",
  "AttributeGroupRef",
  "ComdatRef",
]);

const TYPE_PATTERN =
  /(?:^|[\s,(])((?:i[1-9][0-9]*)|ptr|void|label|metadata|float|double|half|bfloat|x86_fp80|fp128|ppc_fp128)\s*$/u;
const LEADING_TYPE_PATTERN =
  /^\s*((?:i[1-9][0-9]*)|ptr|void|label|metadata|float|double|half|bfloat|x86_fp80|fp128|ppc_fp128)\b/u;

/** AST から意味モデルを構築する純粋関数。 */
export const analyze = (ast: Module, options: AnalyzeOptions = {}): SemanticModel => {
  const moduleScope: Scope = { id: MODULE_SCOPE_ID, name: MODULE_SCOPE_NAME, symbols: new Map() };
  const functionScopes = new Map<string, Scope>();
  const symbols: MutableSymbol[] = [];
  const occurrences: Occurrence[] = [];
  const diagnostics: AnalyzerDiagnostic[] = [];
  const reportUndefinedReferences = options.reportUndefinedReferences ?? true;

  const addSymbol = (
    scope: Scope,
    ref: IdentifierRef,
    kind: SymbolKind,
    type?: string,
  ): MutableSymbol => {
    const existing = scope.symbols.get(ref.name);
    const symbol: MutableSymbol = {
      id: `${scope.id}:${ref.name}:${symbols.length}`,
      name: ref.name,
      kind,
      scopeId: scope.id,
      scopeName: scope.name,
      definition: ref,
      references: [ref],
      ...(type ? { type } : {}),
    };
    if (existing) {
      diagnostics.push({
        code: "duplicate-definition",
        range: ref.range,
        message: `\`${ref.name}\` は既に定義されています`,
        severity: "error",
      });
    }
    scope.symbols.set(ref.name, symbol);
    symbols.push(symbol);
    occurrences.push({ ref, symbol });
    return symbol;
  };

  const addReference = (symbol: MutableSymbol, ref: IdentifierRef): void => {
    symbol.references.push(ref);
    occurrences.push({ ref, symbol });
  };

  const addUndefined = (ref: IdentifierRef): void => {
    if (!reportUndefinedReferences) return;
    diagnostics.push({
      code: "undefined-reference",
      range: ref.range,
      message: `\`${ref.name}\` が定義されていません`,
      severity: "error",
    });
  };

  for (const entry of ast.entries) {
    if (!entry.defines || entry.defines.name === "") continue;
    addSymbol(moduleScope, entry.defines, symbolKindOfEntry(entry));
  }

  for (const entry of ast.entries) {
    if (entry.kind !== "FunctionDefinition") continue;
    const functionScope = makeFunctionScope(entry);
    functionScopes.set(entry.defines.name, functionScope);
    for (const ref of entry.references.filter((r) => r.kind === "LocalRef")) {
      addSymbol(functionScope, ref, "parameter", inferTypeBefore(options.source, ref));
    }
    for (const block of entry.blocks) {
      if (block.label) addSymbol(functionScope, block.label, "label", "label");
      for (const instruction of block.instructions) {
        if (instruction.result) {
          addSymbol(
            functionScope,
            instruction.result,
            "local",
            inferInstructionResultType(options.source, instruction),
          );
        }
      }
    }
  }

  for (const entry of ast.entries) {
    if (entry.kind !== "FunctionDefinition") {
      resolveRefs(entry.references, moduleScope, undefined, addReference, addUndefined);
      continue;
    }
    const functionScope = functionScopes.get(entry.defines.name);
    resolveRefs(entry.references, moduleScope, functionScope, addReference, addUndefined);
    for (const block of entry.blocks) {
      for (const instruction of block.instructions) {
        resolveRefs(instruction.operands, moduleScope, functionScope, addReference, addUndefined);
      }
    }
  }

  return makeModel(symbols, occurrences, diagnostics, ast.entries, functionScopes);
};

const makeFunctionScope = (entry: FunctionDefinition): Scope => ({
  id: `function:${entry.defines.name}`,
  name: entry.defines.name,
  symbols: new Map(),
});

const symbolKindOfEntry = (entry: TopLevelEntry): SymbolKind => {
  switch (entry.kind) {
    case "GlobalVariable":
      return "global";
    case "FunctionDeclaration":
    case "FunctionDefinition":
      return "function";
    case "TypeDefinition":
      return "type";
    case "MetadataDefinition":
      return "metadata";
    case "AttributeGroupDefinition":
      return "attributeGroup";
    default:
      return "global";
  }
};

const resolveRefs = (
  refs: readonly IdentifierRef[],
  moduleScope: Scope,
  functionScope: Scope | undefined,
  addReference: (symbol: MutableSymbol, ref: IdentifierRef) => void,
  addUndefined: (ref: IdentifierRef) => void,
): void => {
  for (const ref of refs) {
    const symbol = resolveRef(ref, moduleScope, functionScope);
    if (symbol) addReference(symbol, ref);
    else addUndefined(ref);
  }
};

const resolveRef = (
  ref: IdentifierRef,
  moduleScope: Scope,
  functionScope: Scope | undefined,
): MutableSymbol | undefined => {
  if (ref.kind === "LabelRef") return functionScope?.symbols.get(labelNameOf(ref));
  if (ref.kind === "LocalRef")
    return functionScope?.symbols.get(ref.name) ?? moduleScope.symbols.get(ref.name);
  if (MODULE_REF_KINDS.has(ref.kind)) return moduleScope.symbols.get(ref.name);
  return undefined;
};

const labelNameOf = (ref: IdentifierRef): string =>
  ref.name.startsWith("%") ? ref.name.slice(1) : ref.name;

const inferInstructionResultType = (
  source: string | undefined,
  instruction: Instruction,
): string | undefined => {
  if (!source || !instruction.opcode) return undefined;
  const line = source.slice(instruction.range.start.offset, instruction.range.end.offset);
  const opcodeMatch = new RegExp(`(?:^|[\\s=])${escapeRegExp(instruction.opcode)}\\b`, "u").exec(
    line,
  );
  if (!opcodeMatch) return undefined;
  const afterOpcode = line.slice(opcodeMatch.index + opcodeMatch[0].length);
  return afterOpcode.match(LEADING_TYPE_PATTERN)?.[1];
};

const inferTypeBefore = (source: string | undefined, ref: IdentifierRef): string | undefined => {
  if (!source) return undefined;
  const lineStart = source.lastIndexOf("\n", Math.max(0, ref.range.start.offset - 1)) + 1;
  const before = source.slice(lineStart, ref.range.start.offset);
  return before.match(TYPE_PATTERN)?.[1];
};

const makeModel = (
  mutableSymbols: readonly MutableSymbol[],
  occurrences: readonly Occurrence[],
  diagnostics: readonly AnalyzerDiagnostic[],
  entries: readonly TopLevelEntry[],
  functionScopes: ReadonlyMap<string, Scope>,
): SemanticModel => {
  const symbols = mutableSymbols.map((symbol) => freezeSymbol(symbol));
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const mutableById = new Map(mutableSymbols.map((symbol) => [symbol.id, symbol]));

  const symbolAt = (position: Position): SemanticSymbol | undefined =>
    occurrences.find((occurrence) => contains(occurrence.ref.range, position))?.symbol;

  return {
    symbols,
    symbolAt: (position) => {
      const symbol = symbolAt(position);
      return symbol ? byId.get(symbol.id) : undefined;
    },
    definitionAt: (position) => {
      const symbol = symbolAt(position);
      return symbol ? byId.get(symbol.id) : undefined;
    },
    referencesOf: (symbolId) => mutableById.get(symbolId)?.references.toSorted(compareRefs) ?? [],
    documentSymbols: () => makeDocumentSymbols(entries, functionScopes),
    diagnostics: () => diagnostics,
  };
};

const freezeSymbol = (symbol: MutableSymbol): SemanticSymbol => ({
  id: symbol.id,
  name: symbol.name,
  kind: symbol.kind,
  scopeId: symbol.scopeId,
  scopeName: symbol.scopeName,
  definition: symbol.definition,
  references: symbol.references.toSorted(compareRefs),
  ...(symbol.type ? { type: symbol.type } : {}),
});

const makeDocumentSymbols = (
  entries: readonly TopLevelEntry[],
  functionScopes: ReadonlyMap<string, Scope>,
): DocumentSymbol[] => {
  const docs: DocumentSymbol[] = [];
  for (const entry of entries) {
    if (!entry.defines || entry.defines.name === "") continue;
    const doc: DocumentSymbol = {
      name: entry.defines.name,
      kind: symbolKindOfEntry(entry),
      range: entry.range,
      selectionRange: entry.defines.range,
      ...(entry.kind === "FunctionDefinition"
        ? { children: functionChildren(entry, functionScopes.get(entry.defines.name)) }
        : {}),
    };
    docs.push(doc);
  }
  return docs;
};

const functionChildren = (
  entry: FunctionDefinition,
  scope: Scope | undefined,
): readonly DocumentSymbol[] => {
  if (!scope) return [];
  const seen = new Set<SymbolId>();
  const refs = [
    ...entry.references.filter((r) => r.kind === "LocalRef"),
    ...entry.blocks.flatMap((block) => refsInBlock(block)),
  ];
  return refs
    .map((ref) => scope.symbols.get(ref.kind === "LabelRef" ? labelNameOf(ref) : ref.name))
    .filter((symbol): symbol is MutableSymbol => symbol !== undefined)
    .filter((symbol) => uniqueSymbol(symbol, seen))
    .map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      range: symbol.definition.range,
      selectionRange: symbol.definition.range,
    }));
};

const refsInBlock = (block: BasicBlock): IdentifierRef[] => [
  ...(block.label ? [block.label] : []),
  ...block.instructions.flatMap((instruction) => (instruction.result ? [instruction.result] : [])),
];

const uniqueSymbol = (symbol: MutableSymbol, seen: Set<SymbolId>): boolean => {
  if (seen.has(symbol.id)) return false;
  seen.add(symbol.id);
  return true;
};

const contains = (range: Range, position: Position): boolean =>
  (position.offset > range.start.offset ||
    (position.offset === range.start.offset && position.line >= range.start.line)) &&
  position.offset < range.end.offset;

const compareRefs = (a: IdentifierRef, b: IdentifierRef): number =>
  a.range.start.offset - b.range.start.offset;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
