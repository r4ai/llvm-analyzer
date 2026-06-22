import {
  analyze,
  opcodeDocs,
  typeDocs,
  type SemanticSymbol,
  type SymbolKind,
} from "@llvm-analyzer/analyzer";
import {
  formatLlvmIr,
  parseModule,
  tokenize,
  type ParseDiagnostic,
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

export interface DocumentSnapshot {
  readonly uri: string;
  readonly version: number;
  readonly text: string;
  readonly document: TextDocument;
  readonly parse: ReturnType<typeof parseModule>;
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
  const parse = parseModule(text);
  const model = analyze(parse.ast, { source: text });
  return { uri, version, text, document, parse, model };
};

/** hover 表示を返す。識別子外では undefined。 */
export const getHover = (snapshot: DocumentSnapshot, position: LspPosition): Hover | undefined => {
  const occurrence = symbolOccurrenceAt(snapshot, position);
  if (!occurrence) return docHoverAt(snapshot, position);
  const { symbol, ref } = occurrence;
  const lines = [`\`${symbol.name}\``, "", `種類: ${symbol.kind}`];
  if (symbol.type) lines.push(`型: ${symbol.type}`);
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: lines.join("\n"),
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
export const getDocumentSymbols = (snapshot: DocumentSnapshot): DocumentSymbol[] =>
  snapshot.model.documentSymbols().map((symbol) => ({
    name: symbol.name,
    kind: toLspSymbolKind(symbol.kind),
    range: toLspRange(symbol.range),
    selectionRange: toLspRange(symbol.selectionRange),
    children: symbol.children?.map((child) => ({
      name: child.name,
      kind: toLspSymbolKind(child.kind),
      range: toLspRange(child.range),
      selectionRange: toLspRange(child.selectionRange),
    })),
  }));

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
        severity:
          diagnostic.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
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
    kind: completionKindOf(symbol.kind),
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
  const refs = snapshot.model.symbols
    .flatMap((symbol) =>
      snapshot.model.referencesOf(symbol.id).map((ref) => ({
        ref,
        symbol,
        isDefinition: sameRange(ref.range, symbol.definition.range),
      })),
    )
    .toSorted((a, b) => a.ref.range.start.offset - b.ref.range.start.offset);
  let prevLine = 0;
  let prevChar = 0;
  const data: number[] = [];
  for (const item of refs) {
    const start = item.ref.range.start;
    const lineDelta = start.line - prevLine;
    const charDelta = lineDelta === 0 ? start.column - prevChar : start.column;
    const tokenType = TOKEN_TYPE_INDEX.get(tokenTypeOf(item.symbol.kind)) ?? 1;
    const modifiers = item.isDefinition ? 1 << (TOKEN_MODIFIER_INDEX.get("definition") ?? 0) : 0;
    data.push(lineDelta, charDelta, item.ref.range.end.column - start.column, tokenType, modifiers);
    prevLine = start.line;
    prevChar = start.column;
  }
  return { data, resultId: snapshot.version.toString() };
};

/** 関数定義ブロックの foldingRange を返す。 */
export const getFoldingRanges = (snapshot: DocumentSnapshot): FoldingRange[] =>
  snapshot.parse.ast.entries
    .filter((entry) => entry.kind === "FunctionDefinition")
    .map((entry) => ({
      startLine: entry.range.start.line,
      startCharacter: entry.range.start.column,
      endLine: entry.range.end.line,
      endCharacter: entry.range.end.column,
    }));

/** SSA値の推定型を inlay hint として返す。 */
export const getInlayHints = (
  snapshot: DocumentSnapshot,
  range?: LspRange,
  settings: InlayHintSettings = defaultInlayHintSettings,
): InlayHint[] => {
  if (!settings.types.enabled) return [];
  return snapshot.model.symbols
    .filter((symbol) => (symbol.kind === "parameter" || symbol.kind === "local") && symbol.type)
    .filter((symbol) => !range || positionInRange(symbol.definition.range.end, range))
    .map((symbol) => ({
      position: {
        line: symbol.definition.range.end.line,
        character: symbol.definition.range.end.column,
      },
      label: `: ${symbol.type}`,
      kind: InlayHintKind.Type,
    }));
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
  const lines = snapshot.text.split("\n");
  const formattedLines = formatLlvmIr(snapshot.text).split("\n");
  const startLine = clamp(range.start.line, 0, Math.max(lines.length - 1, 0));
  const endLineExclusive = clamp(
    range.end.character === 0 ? range.end.line : range.end.line + 1,
    startLine,
    lines.length,
  );
  const originalText = replacementText(lines, startLine, endLineExclusive);
  const newText = replacementText(formattedLines, startLine, endLineExclusive);
  if (originalText === newText) return [];
  return [
    {
      range: {
        start: { line: startLine, character: 0 },
        end:
          endLineExclusive < lines.length
            ? { line: endLineExclusive, character: 0 }
            : snapshot.document.positionAt(snapshot.text.length),
      },
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
  const candidates = replacementCandidates(snapshot, current, range).filter(
    (candidate) => candidate !== current,
  );
  return candidates.toSorted((a, b) => editDistance(current, a) - editDistance(current, b))[0];
};

const replacementCandidates = (
  snapshot: DocumentSnapshot,
  current: string,
  range: LspRange,
): string[] => {
  if (current.startsWith("@")) {
    return snapshot.model.symbols
      .filter(
        (symbol) =>
          symbol.scopeId === "module" && (symbol.kind === "function" || symbol.kind === "global"),
      )
      .map((symbol) => symbol.name)
      .filter((name) => isCloseName(current, name));
  }
  if (current.startsWith("%")) {
    if (!isLabelReferenceContext(snapshot, range)) return [];
    const functionGraph = snapshot.model.controlFlowGraphAt(
      toParserPosition(snapshot, range.start),
    );
    if (!functionGraph) return [];
    return snapshot.model.symbols
      .filter(
        (symbol) => symbol.kind === "label" && symbol.scopeName === functionGraph.functionName,
      )
      .map((symbol) => `%${symbol.name}`)
      .filter((name) => isCloseName(current, name));
  }
  return [];
};

const isLabelReferenceContext = (snapshot: DocumentSnapshot, range: LspRange): boolean => {
  const offset = snapshot.document.offsetAt(range.start);
  const lineStart = snapshot.text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const before = snapshot.text.slice(lineStart, offset).trimEnd();
  return /\blabel\s*$/u.test(before);
};

const isCloseName = (current: string, candidate: string): boolean =>
  editDistance(current, candidate) <= Math.max(2, Math.floor(current.length / 3));

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
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
};

const replacementText = (
  lines: readonly string[],
  startLine: number,
  endLineExclusive: number,
): string =>
  `${lines.slice(startLine, endLineExclusive).join("\n")}${
    endLineExclusive < lines.length ? "\n" : ""
  }`;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const positionInRange = (position: Range["end"], range: LspRange): boolean =>
  comparePosition(position, range.start) >= 0 && comparePosition(position, range.end) <= 0;

const comparePosition = (
  left: { readonly line: number; readonly character?: number; readonly column?: number },
  right: { readonly line: number; readonly character?: number; readonly column?: number },
): number => {
  const leftCharacter = left.character ?? left.column ?? 0;
  const rightCharacter = right.character ?? right.column ?? 0;
  if (left.line !== right.line) return left.line - right.line;
  return leftCharacter - rightCharacter;
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
  const symbol = snapshot.model.symbolAt(parserPosition);
  if (!symbol) return undefined;
  const ref = snapshot.model
    .referencesOf(symbol.id)
    .find((candidate) => containsRange(candidate.range, parserPosition));
  return ref ? { symbol, ref } : undefined;
};

const docHoverAt = (snapshot: DocumentSnapshot, position: LspPosition): Hover | undefined => {
  const token = tokenAt(snapshot, position);
  if (!token) return undefined;
  const doc = opcodeDocs.get(token.value) ?? typeDocs.get(token.value);
  if (!doc) return undefined;
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: [`\`${doc.label}\``, "", doc.markdown].join("\n"),
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
  const graph = snapshot.model.controlFlowGraphAt(toParserPosition(snapshot, position));
  return snapshot.model.symbols.filter(
    (symbol) =>
      symbol.scopeId === "module" ||
      (graph !== undefined && symbol.scopeName === graph.functionName),
  );
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
  severity: diagnostic.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
  source: "llvm-parser",
});

const toLspSymbolKind = (kind: SymbolKind): LspSymbolKind => {
  switch (kind) {
    case "function":
      return LspSymbolKind.Function;
    case "global":
      return LspSymbolKind.Variable;
    case "type":
      return LspSymbolKind.Struct;
    case "parameter":
      return LspSymbolKind.Constant;
    case "local":
      return LspSymbolKind.Variable;
    case "label":
      return LspSymbolKind.Key;
    case "metadata":
      return LspSymbolKind.Object;
    case "attributeGroup":
    case "comdat":
      return LspSymbolKind.Namespace;
  }
};

const completionKindOf = (kind: SymbolKind): CompletionItemKind => {
  switch (kind) {
    case "function":
      return CompletionItemKind.Function;
    case "type":
      return CompletionItemKind.Struct;
    case "parameter":
    case "local":
      return CompletionItemKind.Variable;
    default:
      return CompletionItemKind.Reference;
  }
};

const tokenTypeOf = (kind: SymbolKind): string => {
  switch (kind) {
    case "function":
      return "function";
    case "type":
      return "type";
    case "parameter":
      return "parameter";
    case "label":
      return "label";
    case "metadata":
    case "attributeGroup":
    case "comdat":
      return "namespace";
    default:
      return "variable";
  }
};

const normalizeRenameForRef = (
  symbol: SemanticSymbol,
  ref: SemanticSymbol["references"][number],
  newName: string,
): string => {
  if (symbol.kind === "label") {
    const bareName = newName.replace(/^%/u, "");
    return sameRange(ref.range, symbol.definition.range) ? bareName : `%${bareName}`;
  }
  const sigil = symbol.name.match(/^[@%!#$]/u)?.[0];
  if (!sigil || newName.startsWith(sigil)) return newName;
  return `${sigil}${newName}`;
};

const sameRange = (a: Range, b: Range): boolean =>
  a.start.offset === b.start.offset && a.end.offset === b.end.offset;

const containsRange = (
  range: Range,
  position: { readonly offset: number; readonly line: number },
): boolean =>
  (position.offset > range.start.offset ||
    (position.offset === range.start.offset && position.line >= range.start.line)) &&
  position.offset < range.end.offset;
