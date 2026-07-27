import {
  analyze,
  attributeDocs,
  formatControlFlowGraphAsMermaid,
  opcodeDocs,
  typeDocs,
  type SemanticSymbol,
  type SymbolKind,
} from "@llvm-analyzer/analyzer";
import {
  formatLlvmIr,
  formatLlvmIrFragment,
  IncrementalParserSession,
  tokenize,
  type ParseDiagnostic,
  type ParseResult,
  type Position,
  type Range,
} from "@llvm-analyzer/parser";
import {
  CompletionItemKind,
  DiagnosticSeverity,
  InlayHintKind,
  MarkupKind,
  SymbolKind as LspSymbolKind,
  type CompletionItem,
  type CodeAction,
  type Diagnostic,
  type DocumentSymbol,
  type FoldingRange,
  type Hover,
  type InlayHint,
  type Location,
  type Position as LspPosition,
  type Range as LspRange,
  type SemanticTokens,
  type SemanticTokensLegend,
  type TextDocumentContentChangeEvent,
  type TextEdit,
  type WorkspaceEdit,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  applyDiagnosticSettings,
  defaultDiagnosticSettings,
  type DiagnosticSettings,
} from "./diagnostics.ts";

export const semanticTokenLegend: SemanticTokensLegend = {
  tokenTypes: [
    "function",
    "variable",
    "parameter",
    "type",
    "namespace",
    "property",
    "label",
    "keyword",
  ],
  tokenModifiers: ["definition", "readonly"],
};

const TOKEN_TYPE_INDEX = new Map(
  semanticTokenLegend.tokenTypes.map((type, index) => [type, index]),
);
const TOKEN_MODIFIER_INDEX = new Map(
  semanticTokenLegend.tokenModifiers.map((modifier, index) => [modifier, index]),
);

const LSP_SYMBOL_KINDS: Readonly<Record<SymbolKind, LspSymbolKind>> = {
  attributeGroup: LspSymbolKind.Namespace,
  comdat: LspSymbolKind.Namespace,
  function: LspSymbolKind.Function,
  global: LspSymbolKind.Variable,
  label: LspSymbolKind.Key,
  local: LspSymbolKind.Variable,
  metadata: LspSymbolKind.Object,
  parameter: LspSymbolKind.Constant,
  type: LspSymbolKind.Struct,
};

const COMPLETION_KINDS: Readonly<Record<SymbolKind, CompletionItemKind>> = {
  attributeGroup: CompletionItemKind.Reference,
  comdat: CompletionItemKind.Reference,
  function: CompletionItemKind.Function,
  global: CompletionItemKind.Reference,
  label: CompletionItemKind.Reference,
  local: CompletionItemKind.Variable,
  metadata: CompletionItemKind.Reference,
  parameter: CompletionItemKind.Variable,
  type: CompletionItemKind.Struct,
};

const SEMANTIC_TOKEN_TYPES: Readonly<Record<SymbolKind, string>> = {
  attributeGroup: "namespace",
  comdat: "namespace",
  function: "function",
  global: "variable",
  label: "label",
  local: "variable",
  metadata: "namespace",
  parameter: "parameter",
  type: "type",
};

const PARSE_DIAGNOSTIC_SEVERITIES: Readonly<
  Record<ParseDiagnostic["severity"], DiagnosticSeverity>
> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
};

const ANALYZER_DIAGNOSTIC_SEVERITIES = PARSE_DIAGNOSTIC_SEVERITIES;

const KEYWORD_COMPLETIONS = [
  "define",
  "declare",
  "ret",
  "br",
  "call",
  "load",
  "store",
  "add",
  "icmp",
  "ptrtoaddr",
  "captures",
  "memory",
  "nofpclass",
  "denormal_fpenv",
  "module",
  "asm",
  "comdat",
  "uselistorder",
  "uselistorder_bb",
];

interface ReplacementNameIndex {
  readonly moduleNamesByLength: ReadonlyMap<number, readonly string[]>;
  readonly labelNamesByScopeAndLength: ReadonlyMap<string, ReadonlyMap<number, readonly string[]>>;
}

const replacementNamesBySnapshot = new WeakMap<DocumentSnapshot, ReplacementNameIndex>();
const documentSymbolsBySnapshot = new WeakMap<DocumentSnapshot, DocumentSymbol[]>();
const semanticTokensBySnapshot = new WeakMap<DocumentSnapshot, SemanticTokens>();
const foldingRangesBySnapshot = new WeakMap<DocumentSnapshot, FoldingRange[]>();

export interface DocumentSnapshot {
  readonly uri: string;
  readonly version: number;
  readonly text: string;
  readonly document: TextDocument;
  readonly parser: IncrementalParserSession;
  readonly parse: ParseResult;
  readonly model: ReturnType<typeof analyze>;
}

export interface InlayHintSettings {
  readonly types: {
    readonly enabled: boolean;
  };
}

export const defaultInlayHintSettings: InlayHintSettings = {
  types: { enabled: true },
};

/** raw configuration を inlay hint 設定へ正規化する。 */
export const normalizeInlayHintSettings = (raw: unknown): InlayHintSettings => {
  if (!isRecord(raw)) return defaultInlayHintSettings;
  return {
    types: {
      enabled: isRecord(raw.types)
        ? booleanSetting(raw.types.enabled, defaultInlayHintSettings.types.enabled)
        : defaultInlayHintSettings.types.enabled,
    },
  };
};

/** Inlay hint provider の capability 宣言。 */
export const inlayHintProviderCapability = true;
/** formatting / rangeFormatting provider の capability 宣言。 */
export const formattingProviderCapability = true;
/** codeAction provider の capability 宣言。 */
export const codeActionProviderCapability = { codeActionKinds: ["quickfix"] };

export interface ReferenceOptions {
  readonly includeDeclaration?: boolean;
}

/**
 * LSP 機能の入力に使う不変スナップショットを作る。
 *
 * @param uri ドキュメント URI。
 * @param text LLVM IR ソース。
 * @param version ドキュメントバージョン。省略時は 1。
 * @returns parser / analyzer 済みのスナップショット。
 */
export const makeDocumentSnapshot = (uri: string, text: string, version = 1): DocumentSnapshot => {
  const document = TextDocument.create(uri, "llvm", version, text);
  const parser = IncrementalParserSession.create(text);
  const parse = parser.result;
  const model = analyze(parse.ast, { source: text });
  return createSnapshot({ uri, version, text, document, parser, parse, model });
};

/**
 * 前回の解析結果を使い、更新後の不変スナップショットを作る。
 *
 * @param previous 同じURIに対応する直前のスナップショット。
 * @param text 更新後のLLVM IRソース。
 * @param version 更新後のドキュメントバージョン。
 * @param changes LSPが通知した順序付き変更列。省略時は全文から差分を推定する。
 * @returns 局所パースまたは安全な全体パースから作ったスナップショット。
 *
 * @remarks
 * parserが変更対象を単一トップレベル要素へ限定できない場合は、全体を再パースする。
 * 意味モデルはモジュールをまたぐ参照契約を維持するため、更新後のAST全体を線形時間で再リンクする。
 */
export const updateDocumentSnapshot = (
  previous: DocumentSnapshot,
  text: string,
  version: number,
  changes?: readonly TextDocumentContentChangeEvent[],
): DocumentSnapshot => {
  const document = TextDocument.create(previous.uri, "llvm", version, text);
  const parser = changes
    ? applyContentChanges(previous.parser, previous.document, changes, text)
    : previous.parser.updateFromSource(text);
  const parse = parser.result;
  const model = analyze(parse.ast, { source: text });
  return createSnapshot({
    uri: previous.uri,
    version,
    text,
    document,
    parser,
    parse,
    model,
  });
};

const createSnapshot = (snapshot: DocumentSnapshot): DocumentSnapshot => {
  snapshot.document.positionAt(snapshot.text.length);
  replacementNameIndex(snapshot);
  return snapshot;
};

const applyContentChanges = (
  initialParser: IncrementalParserSession,
  initialDocument: TextDocument,
  changes: readonly TextDocumentContentChangeEvent[],
  expectedSource: string,
): IncrementalParserSession => {
  let parser = initialParser;
  let document = TextDocument.create(
    initialDocument.uri,
    initialDocument.languageId,
    initialDocument.version,
    initialDocument.getText(),
  );
  for (const change of changes) {
    let nextDocument: TextDocument;
    if ("range" in change) {
      const offsets = {
        start: document.offsetAt(change.range.start),
        end: document.offsetAt(change.range.end),
      };
      nextDocument = TextDocument.update(document, [change], document.version + 1);
      const nextSource = nextDocument.getText();
      parser = parser.update(nextSource, incrementalEdit(nextDocument, change, offsets));
    } else {
      nextDocument = TextDocument.update(document, [change], document.version + 1);
      parser = parser.replace(change.text);
    }
    document = nextDocument;
  }
  return parser.source === expectedSource ? parser : parser.replace(expectedSource);
};

const incrementalEdit = (
  updated: TextDocument,
  change: Extract<TextDocumentContentChangeEvent, { range: unknown }>,
  offsets: { readonly start: number; readonly end: number },
): { readonly range: Range; readonly newEnd: Position } => {
  return {
    range: {
      start: toParserEditPosition(change.range.start, offsets.start),
      end: toParserEditPosition(change.range.end, offsets.end),
    },
    newEnd: toParserEditPosition(
      updated.positionAt(offsets.start + change.text.length),
      offsets.start + change.text.length,
    ),
  };
};

const toParserEditPosition = (position: LspPosition, offset: number): Position => ({
  offset,
  line: position.line,
  column: position.character,
});

/** hover 表示を返す。識別子外では undefined。 */
export const getHover = (snapshot: DocumentSnapshot, position: LspPosition): Hover | undefined => {
  const occurrence = symbolOccurrenceAt(snapshot, position);
  if (!occurrence) return docHoverAt(snapshot, position);
  const { symbol, ref } = occurrence;
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: symbolHoverMarkdown(snapshot, symbol),
    },
    range: toLspRange(ref.range),
  };
};

/** definition の Location を返す。未解決なら undefined。 */
export const getDefinition = (
  snapshot: DocumentSnapshot,
  position: LspPosition,
): Location | undefined => {
  const symbol = snapshot.model.definitionAt(toParserPosition(snapshot, position));
  if (!symbol) return undefined;
  return {
    uri: snapshot.uri,
    range: toLspRange(symbol.definition.range),
  };
};

/** references の Location 列を返す。未解決なら空配列。 */
export const getReferences = (
  snapshot: DocumentSnapshot,
  position: LspPosition,
  options: ReferenceOptions = {},
): Location[] => {
  const symbol = symbolAt(snapshot, position);
  if (!symbol) return [];
  return snapshot.model
    .referencesOf(symbol.id)
    .filter(
      (ref) =>
        options.includeDeclaration !== false || !sameRange(ref.range, symbol.definition.range),
    )
    .map((ref) => ({
      uri: snapshot.uri,
      range: toLspRange(ref.range),
    }));
};

/** documentSymbol 用の階層シンボルを返す。 */
export const getDocumentSymbols = (snapshot: DocumentSnapshot): DocumentSymbol[] => {
  const cached = documentSymbolsBySnapshot.get(snapshot);
  if (cached) return cached;
  const symbols = snapshot.model.documentSymbols().map((symbol) => ({
    name: symbol.name,
    kind: LSP_SYMBOL_KINDS[symbol.kind],
    range: toLspRange(symbol.range),
    selectionRange: toLspRange(symbol.selectionRange),
    children: symbol.children?.map((child) => ({
      name: child.name,
      kind: LSP_SYMBOL_KINDS[child.kind],
      range: toLspRange(child.range),
      selectionRange: toLspRange(child.selectionRange),
    })),
  }));
  documentSymbolsBySnapshot.set(snapshot, symbols);
  return symbols;
};

/** 構文診断と意味診断を LSP 診断へ変換し、診断設定を適用する。 */
export const getDiagnostics = (
  snapshot: DocumentSnapshot,
  settings: DiagnosticSettings = defaultDiagnosticSettings,
): Diagnostic[] =>
  applyDiagnosticSettings(
    [
      ...snapshot.parse.diagnostics.map(fromParseDiagnostic),
      ...snapshot.model.diagnostics().map((diagnostic) => ({
        range: toLspRange(diagnostic.range),
        message: diagnostic.message,
        severity: ANALYZER_DIAGNOSTIC_SEVERITIES[diagnostic.severity],
        source: "llvm-analyzer",
        code: diagnostic.code,
      })),
    ],
    settings,
  );

/** 補完候補を返す。シンボルと基本命令・トップレベル語を候補にする。 */
export const getCompletionItems = (
  snapshot: DocumentSnapshot,
  position: LspPosition,
): CompletionItem[] => [
  ...completionSymbols(snapshot, position).map((symbol) => ({
    label: symbol.name,
    kind: COMPLETION_KINDS[symbol.kind],
    detail: symbol.type ? `${symbol.kind}: ${symbol.type}` : symbol.kind,
  })),
  ...KEYWORD_COMPLETIONS.map((keyword) => ({
    label: keyword,
    kind: CompletionItemKind.Keyword,
    detail: "LLVM IR keyword/opcode",
  })),
  ...[...typeDocs.values()].map((doc) => ({
    label: doc.label,
    kind: CompletionItemKind.TypeParameter,
    detail: "LLVM IR type",
    documentation: doc.markdown,
  })),
];

/** rename 用の WorkspaceEdit を返す。未解決位置では undefined。 */
export const getRenameEdit = (
  snapshot: DocumentSnapshot,
  position: LspPosition,
  newName: string,
): WorkspaceEdit | undefined => {
  const symbol = symbolAt(snapshot, position);
  if (!symbol) return undefined;
  const edits = snapshot.model.referencesOf(symbol.id).map(
    (ref): TextEdit => ({
      range: toLspRange(ref.range),
      newText: normalizeRenameForRef(symbol, ref, newName),
    }),
  );
  return { changes: { [snapshot.uri]: edits } };
};

/** semanticTokens を返す。シンボル出現を delta encoding する。 */
export const getSemanticTokens = (snapshot: DocumentSnapshot): SemanticTokens => {
  const cached = semanticTokensBySnapshot.get(snapshot);
  if (cached) return cached;
  let prevLine = 0;
  let prevChar = 0;
  const data: number[] = [];
  for (const { ref, symbol } of snapshot.model.occurrences()) {
    const start = ref.range.start;
    const lineDelta = start.line - prevLine;
    const charDelta = lineDelta === 0 ? start.column - prevChar : start.column;
    const tokenType = TOKEN_TYPE_INDEX.get(SEMANTIC_TOKEN_TYPES[symbol.kind])!;
    const modifiers = sameRange(ref.range, symbol.definition.range)
      ? 1 << TOKEN_MODIFIER_INDEX.get("definition")!
      : 0;
    data.push(lineDelta, charDelta, ref.range.end.column - start.column, tokenType, modifiers);
    prevLine = start.line;
    prevChar = start.column;
  }
  const tokens = { data, resultId: snapshot.version.toString() };
  semanticTokensBySnapshot.set(snapshot, tokens);
  return tokens;
};

/** 関数定義ブロックの foldingRange を返す。 */
export const getFoldingRanges = (snapshot: DocumentSnapshot): FoldingRange[] => {
  const cached = foldingRangesBySnapshot.get(snapshot);
  if (cached) return cached;
  const ranges = snapshot.parse.ast.entries
    .filter((entry) => entry.kind === "FunctionDefinition")
    .map((entry) => ({
      startLine: entry.range.start.line,
      startCharacter: entry.range.start.column,
      endLine: entry.range.end.line,
      endCharacter: entry.range.end.column,
    }));
  foldingRangesBySnapshot.set(snapshot, ranges);
  return ranges;
};

/**
 * 指定位置を含む関数のCFGをMermaidとして返す。
 *
 * @param snapshot 解析済みの不変スナップショット。
 * @param position 関数内のLSP位置。
 * @returns 関数内ならMermaidテキスト。関数外ならundefined。
 */
export const getControlFlowGraph = (
  snapshot: DocumentSnapshot,
  position: LspPosition,
): string | undefined => {
  const graph = snapshot.model.controlFlowGraphAt(toParserPosition(snapshot, position));
  return graph ? formatControlFlowGraphAsMermaid(graph) : undefined;
};

/** SSA値の推定型を inlay hint として返す。 */
export const getInlayHints = (
  snapshot: DocumentSnapshot,
  range?: LspRange,
  settings: InlayHintSettings = defaultInlayHintSettings,
): InlayHint[] => {
  if (!settings.types.enabled) return [];
  const symbols = range
    ? snapshot.model.symbolsInRange({
        start: toParserPosition(snapshot, range.start),
        end: toParserPosition(snapshot, range.end),
      })
    : snapshot.model.symbols;
  return symbols
    .filter((symbol) => symbol.kind === "parameter" || symbol.kind === "local")
    .flatMap((symbol) => {
      const type = symbol.type;
      return type
        ? [
            {
              position: {
                line: symbol.definition.range.end.line,
                character: symbol.definition.range.end.column,
              },
              label: `: ${type}`,
              kind: InlayHintKind.Type,
            },
          ]
        : [];
    });
};

/** ドキュメント全体の formatting edit を返す。変更不要なら空配列。 */
export const getFormattingEdits = (snapshot: DocumentSnapshot): TextEdit[] => {
  const formatted = formatLlvmIr(snapshot.text);
  if (formatted === snapshot.text) return [];
  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: snapshot.document.positionAt(snapshot.text.length),
      },
      newText: formatted,
    },
  ];
};

/** 指定 range と交差する行全体の rangeFormatting edit を返す。 */
export const getRangeFormattingEdits = (
  snapshot: DocumentSnapshot,
  range: LspRange,
): TextEdit[] => {
  const startLine = clamp(range.start.line, 0, Math.max(snapshot.document.lineCount - 1, 0));
  const endLineExclusive = clamp(
    range.end.character === 0 ? range.end.line : range.end.line + 1,
    startLine,
    snapshot.document.lineCount,
  );
  const editRange = {
    start: { line: startLine, character: 0 },
    end:
      endLineExclusive < snapshot.document.lineCount
        ? { line: endLineExclusive, character: 0 }
        : snapshot.document.positionAt(snapshot.text.length),
  };
  const originalText = snapshot.document.getText(editRange);
  const graph = snapshot.model.controlFlowGraphAt(toParserPosition(snapshot, editRange.start));
  const newText = formatLlvmIrFragment(
    originalText,
    graph !== undefined && graph.range.start.line < startLine,
  );
  if (originalText === newText) return [];
  return [
    {
      range: editRange,
      newText,
    },
  ];
};

/** 診断に対する安全な Quick Fix を返す。 */
export const getCodeActions = (
  snapshot: DocumentSnapshot,
  range: LspRange,
  diagnostics: readonly Diagnostic[],
): CodeAction[] =>
  diagnostics
    .filter((diagnostic) => rangesOverlap(diagnostic.range, range))
    .flatMap((diagnostic) => codeActionsForDiagnostic(snapshot, diagnostic));

const codeActionsForDiagnostic = (
  snapshot: DocumentSnapshot,
  diagnostic: Diagnostic,
): CodeAction[] => {
  if (diagnostic.source !== "llvm-analyzer") return [];
  if (diagnostic.code === "undefined-reference") {
    const current = snapshot.document.getText(diagnostic.range);
    const candidate = closestReplacement(snapshot, current, diagnostic.range);
    if (!candidate) return [];
    return [
      {
        title: `\`${current}\` を \`${candidate}\` に置換`,
        kind: "quickfix",
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [snapshot.uri]: [{ range: diagnostic.range, newText: candidate }],
          },
        },
      },
    ];
  }
  if (diagnostic.code === "instruction-after-terminator") {
    return [
      {
        title: "終端命令後の命令を削除",
        kind: "quickfix",
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [snapshot.uri]: [
              { range: lineRange(snapshot, diagnostic.range.start.line), newText: "" },
            ],
          },
        },
      },
    ];
  }
  return [];
};

const closestReplacement = (
  snapshot: DocumentSnapshot,
  current: string,
  range: LspRange,
): string | undefined => {
  const threshold = Math.max(2, Math.floor(current.length / 3));
  let closest: string | undefined;
  let closestDistance = threshold + 1;
  for (const candidate of replacementCandidates(snapshot, current, range, threshold)) {
    const distance = editDistance(current, candidate);
    if (distance >= closestDistance) continue;
    closest = candidate;
    closestDistance = distance;
  }
  return closest;
};

const replacementCandidates = (
  snapshot: DocumentSnapshot,
  current: string,
  range: LspRange,
  threshold: number,
): string[] => {
  const index = replacementNameIndex(snapshot);
  if (current.startsWith("@")) {
    return namesWithinLength(index.moduleNamesByLength, current.length, threshold);
  }
  if (current.startsWith("%")) {
    if (!isLabelReferenceContext(snapshot, range)) return [];
    const functionGraph = snapshot.model.controlFlowGraphAt(
      toParserPosition(snapshot, range.start),
    );
    if (!functionGraph) return [];
    const names = index.labelNamesByScopeAndLength.get(functionGraph.functionName);
    return names ? namesWithinLength(names, current.length, threshold) : [];
  }
  return [];
};

const replacementNameIndex = (snapshot: DocumentSnapshot): ReplacementNameIndex => {
  const cached = replacementNamesBySnapshot.get(snapshot);
  if (cached) return cached;
  const moduleNamesByLength = new Map<number, string[]>();
  const labelsByScope = new Map<string, Map<number, string[]>>();
  for (const symbol of snapshot.model.symbols) {
    if (symbol.scopeId === "module" && (symbol.kind === "function" || symbol.kind === "global")) {
      addNameByLength(moduleNamesByLength, symbol.name);
      continue;
    }
    if (symbol.kind !== "label") continue;
    let names = labelsByScope.get(symbol.scopeName);
    if (!names) {
      names = new Map();
      labelsByScope.set(symbol.scopeName, names);
    }
    addNameByLength(names, `%${symbol.name}`);
  }
  const index = {
    moduleNamesByLength,
    labelNamesByScopeAndLength: labelsByScope,
  };
  replacementNamesBySnapshot.set(snapshot, index);
  return index;
};

const addNameByLength = (names: Map<number, string[]>, name: string): void => {
  const sameLength = names.get(name.length);
  if (sameLength) sameLength.push(name);
  else names.set(name.length, [name]);
};

const namesWithinLength = (
  names: ReadonlyMap<number, readonly string[]>,
  length: number,
  threshold: number,
): string[] => {
  const candidates: string[] = [];
  for (
    let candidateLength = Math.max(0, length - threshold);
    candidateLength <= length + threshold;
    candidateLength += 1
  ) {
    candidates.push(...(names.get(candidateLength) ?? []));
  }
  return candidates;
};

const isLabelReferenceContext = (snapshot: DocumentSnapshot, range: LspRange): boolean => {
  const offset = snapshot.document.offsetAt(range.start);
  const lineStart = snapshot.text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const before = snapshot.text.slice(lineStart, offset).trimEnd();
  return /\blabel\s*$/u.test(before);
};

const lineRange = (snapshot: DocumentSnapshot, line: number): LspRange => {
  const nextLineOffset = snapshot.document.offsetAt({ line: line + 1, character: 0 });
  const start = { line, character: 0 };
  if (nextLineOffset < snapshot.text.length)
    return { start, end: { line: line + 1, character: 0 } };
  return { start, end: snapshot.document.positionAt(snapshot.text.length) };
};

const rangesOverlap = (left: LspRange, right: LspRange): boolean =>
  rangeIsEmpty(right)
    ? positionInHalfOpenRange(right.start, left)
    : rangeIsEmpty(left)
      ? positionInHalfOpenRange(left.start, right)
      : comparePosition(left.start, right.end) < 0 && comparePosition(right.start, left.end) < 0;

const rangeIsEmpty = (range: LspRange): boolean => comparePosition(range.start, range.end) === 0;

const positionInHalfOpenRange = (position: LspPosition, range: LspRange): boolean =>
  comparePosition(position, range.start) >= 0 && comparePosition(position, range.end) < 0;

const editDistance = (left: string, right: string): number => {
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const comparePosition = (left: LspPosition, right: LspPosition): number => {
  if (left.line !== right.line) return left.line - right.line;
  return left.character - right.character;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const booleanSetting = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const symbolAt = (snapshot: DocumentSnapshot, position: LspPosition): SemanticSymbol | undefined =>
  snapshot.model.symbolAt(toParserPosition(snapshot, position));

const symbolOccurrenceAt = (
  snapshot: DocumentSnapshot,
  position: LspPosition,
):
  | { readonly symbol: SemanticSymbol; readonly ref: SemanticSymbol["references"][number] }
  | undefined => {
  const parserPosition = toParserPosition(snapshot, position);
  return snapshot.model.occurrenceAt(parserPosition);
};

const symbolHoverMarkdown = (snapshot: DocumentSnapshot, symbol: SemanticSymbol): string => {
  const lines = ["| Property | Value |", "| --- | --- |", `| Kind | \`${symbol.kind}\` |`];
  if (symbol.type) lines.push(`| Type | \`${symbol.type}\` |`);
  if (symbol.scopeName !== "module") lines.push(`| Scope | \`${symbol.scopeName}\` |`);
  const sourceLine = sourceLineAt(snapshot, symbol.definition.range.start.line).trim();
  lines.push("", `${symbolHoverContextLabel(symbol)}:`, "```llvm", sourceLine, "```");
  return lines.join("\n");
};

const symbolHoverContextLabel = (symbol: SemanticSymbol): string =>
  symbol.kind === "parameter" || symbol.kind === "function" ? "Signature" : "Definition";

const sourceLineAt = (snapshot: DocumentSnapshot, line: number): string =>
  snapshot.document.getText({
    start: { line, character: 0 },
    end: { line: line + 1, character: 0 },
  });

const docHoverAt = (snapshot: DocumentSnapshot, position: LspPosition): Hover | undefined => {
  const token = tokenAt(snapshot, position);
  if (!token) return undefined;
  const doc =
    opcodeDocs.get(token.value) ?? typeDocs.get(token.value) ?? attributeDocs.get(token.value);
  if (!doc) return undefined;
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: doc.markdown,
    },
    range: token.range,
  };
};

const tokenAt = (
  snapshot: DocumentSnapshot,
  position: LspPosition,
): { readonly value: string; readonly range: LspRange } | undefined => {
  const lineText = snapshot.document.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });
  const tokens = tokenize(lineText).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  return tokens
    .map((token) => ({
      value: token.value,
      range: {
        start: { line: position.line, character: token.range.start.column },
        end: { line: position.line, character: token.range.end.column },
      },
    }))
    .find(
      (token) =>
        position.character >= token.range.start.character &&
        position.character < token.range.end.character,
    );
};

const completionSymbols = (
  snapshot: DocumentSnapshot,
  position: LspPosition,
): readonly SemanticSymbol[] => {
  return snapshot.model.visibleSymbolsAt(toParserPosition(snapshot, position));
};

const toParserPosition = (snapshot: DocumentSnapshot, position: LspPosition) => ({
  offset: snapshot.document.offsetAt(position),
  line: position.line,
  column: position.character,
});

const toLspRange = (range: Range): LspRange => ({
  start: { line: range.start.line, character: range.start.column },
  end: { line: range.end.line, character: range.end.column },
});

const fromParseDiagnostic = (diagnostic: ParseDiagnostic): Diagnostic => ({
  range: toLspRange(diagnostic.range),
  message: diagnostic.message,
  severity: PARSE_DIAGNOSTIC_SEVERITIES[diagnostic.severity],
  source: "llvm-parser",
});

const normalizeRenameForRef = (
  symbol: SemanticSymbol,
  ref: SemanticSymbol["references"][number],
  newName: string,
): string => {
  if (symbol.kind === "label") {
    const bareName = stripLeadingSigil(newName);
    return sameRange(ref.range, symbol.definition.range) ? bareName : `%${bareName}`;
  }
  const sigil = symbol.name.match(/^[@%!#$]/u)![0];
  if (newName.startsWith(sigil)) return newName;
  return `${sigil}${stripLeadingSigil(newName)}`;
};

const stripLeadingSigil = (name: string): string => name.replace(/^[@%!#$]/u, "");

const sameRange = (a: Range, b: Range): boolean =>
  a.start.offset === b.start.offset && a.end.offset === b.end.offset;
