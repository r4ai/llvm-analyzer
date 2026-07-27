/**
 * LLVM IR の再帰下降パーサ。lexer の出力するトークン列を AST へ組み立てる純粋関数。
 *
 * 粒度は「構造重視・命令は粗く」（[plan](../../../../docs/plans/2026-06-22-parser-ast.md) 参照）。
 * トップレベル構造は型付きノードに分解するが、命令や型の内部は構造化せず、出現する識別子参照を
 * 収集するにとどめる。`define` 本体は `{`...`}` ブロックとして走査し、それ以外のトップレベルは
 * 通常行単位だが、区切り記号が複数行にまたがる場合は閉じるまで 1 エントリとして集める。
 * 1 エントリのパースに失敗しても診断を積んで次へ進む（エラー回復）ため、不正入力でも全体は止まらない。
 */
import { type Range, type Token, tokenize } from "../lexer/index.ts";
import type {
  BasicBlock,
  DebugRecord,
  IdentifierRef,
  Instruction,
  Module,
  ParseDiagnostic,
  ParseResult,
  TopLevelEntry,
  UseListOrderDirective,
} from "../ast/index.ts";

/** 識別子トークンの種別集合（参照として収集する対象）。 */
const IDENTIFIER_KINDS = new Set<Token["kind"]>([
  "GlobalIdentifier",
  "LocalIdentifier",
  "MetadataIdentifier",
  "AttributeGroup",
  "ComdatIdentifier",
]);

/** トークン種別 → {@link IdentifierRef} の `kind` の対応。 */
const REF_KIND: Readonly<Record<Token["kind"], IdentifierRef["kind"] | undefined>> = {
  AttributeGroup: "AttributeGroupRef",
  ComdatIdentifier: "ComdatRef",
  Comment: undefined,
  Constant: undefined,
  DebugRecord: undefined,
  Eof: undefined,
  GlobalIdentifier: "GlobalRef",
  Identifier: undefined,
  Keyword: undefined,
  Label: undefined,
  LocalIdentifier: "LocalRef",
  MetadataIdentifier: "MetadataRef",
  Number: undefined,
  Opcode: undefined,
  Punctuation: undefined,
  String: undefined,
  Type: undefined,
  Unknown: undefined,
} as const;

/** `start`/`end` トークンから範囲を作る（半開区間）。 */
const spanOf = (start: Token, end: Token): Range => ({
  start: start.range.start,
  end: end.range.end,
});

/**
 * 識別子トークンを参照ノードへ変換する。
 * `label %x` の `%x` のように直前が型キーワード `label` の場合は {@link IdentifierRef} を `LabelRef` とする。
 */
const makeRef = (
  token: Token,
  prev: Token | undefined,
  forcedKind?: IdentifierRef["kind"],
): IdentifierRef => {
  const base = REF_KIND[token.kind]!;
  const kind =
    forcedKind ??
    (token.kind === "LocalIdentifier" && prev?.kind === "Type" && prev.value === "label"
      ? "LabelRef"
      : base);
  return { kind, name: token.value, range: token.range };
};

/**
 * トークン列に現れる識別子参照を収集する。
 * `excludeIndex` の位置（そのエントリが定義する名前など）は除外する。
 */
const collectRefs = (tokens: readonly Token[], excludeIndex = -1): IdentifierRef[] => {
  const refs: IdentifierRef[] = [];
  const opcode = instructionOpcode(tokens);
  for (let i = 0; i < tokens.length; i += 1) {
    if (i === excludeIndex) continue;
    const token = tokens[i]!;
    if (isInlineMetadataConstructor(tokens, i)) continue;
    if (isMetadataAttachmentKey(tokens, i)) continue;
    if (IDENTIFIER_KINDS.has(token.kind)) {
      refs.push(makeRef(token, tokens[i - 1], contextualRefKind(tokens, i, opcode)));
    }
  }
  return refs;
};

/**
 * `!DIExpression(...)` のような inline メタデータノードは、参照先 ID ではなく構文要素として扱う。
 */
const isInlineMetadataConstructor = (tokens: readonly Token[], index: number): boolean =>
  tokens[index]?.kind === "MetadataIdentifier" && tokens[index + 1]?.value === "(";

/** `!dbg !0` などの attachment key は定義参照ではなく、直後のメタデータだけを参照として扱う。 */
const isMetadataAttachmentKey = (tokens: readonly Token[], index: number): boolean =>
  tokens[index]?.kind === "MetadataIdentifier" &&
  !/^!\d+$/u.test(tokens[index]!.value) &&
  (tokens[index + 1]?.kind === "MetadataIdentifier" || tokens[index + 1]?.value === "!");

/** 周辺構文から参照種別を補正する。 */
const contextualRefKind = (
  tokens: readonly Token[],
  index: number,
  opcode: string | undefined,
): IdentifierRef["kind"] | undefined => {
  if (isPhiIncomingLabel(tokens, index, opcode) || isBlockAddressLabel(tokens, index)) {
    return "LabelRef";
  }
  return undefined;
};

/** `phi ... [ value, %label ]` の incoming label を検出する。 */
const isPhiIncomingLabel = (
  tokens: readonly Token[],
  index: number,
  opcode: string | undefined,
): boolean =>
  tokens[index]?.kind === "LocalIdentifier" &&
  tokens[index - 1]?.value === "," &&
  tokens[index + 1]?.value === "]" &&
  opcode === "phi";

/** `blockaddress(@f, %bb)` の第2引数ラベルを検出する。 */
const isBlockAddressLabel = (tokens: readonly Token[], index: number): boolean =>
  tokens[index]?.kind === "LocalIdentifier" &&
  tokens[index - 1]?.value === "," &&
  tokens[index + 1]?.value === ")" &&
  ((tokens[index - 3]?.value === "(" && tokens[index - 4]?.value === "blockaddress") ||
    (tokens[index - 2]?.value === "(" && tokens[index - 3]?.value === "blockaddress"));

/** 命令行・本体要素内の最初の opcode。 */
const instructionOpcode = (tokens: readonly Token[]): string | undefined =>
  tokens.find((token) => token.kind === "Opcode")?.value;

/** トークン列から、指定種別の最初のトークンとその位置を探す。 */
const findToken = (
  tokens: readonly Token[],
  kind: Token["kind"],
): { token: Token; index: number } | undefined => {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.kind === kind) return { token, index: i };
  }
  return undefined;
};

/** トークン列から最初の文字列リテラルの生テキストを返す。 */
const firstString = (tokens: readonly Token[]): string | undefined =>
  findToken(tokens, "String")?.token.value;

/** トークン列に指定の語（種別・値）が含まれるか。 */
const hasWord = (tokens: readonly Token[], kind: Token["kind"], value: string): boolean =>
  tokens.some((t) => t.kind === kind && t.value === value);

/**
 * LLVM IR ソースを AST へパースする純粋関数。
 *
 * @param source LLVM IR のソース文字列
 * @returns AST（{@link Module}）と収集した構文診断のペア
 * @example
 * const { ast, diagnostics } = parseModule("@g = global i32 0");
 * ast.entries[0].kind //=> "GlobalVariable"
 */
export const parseModule = (source: string): ParseResult => {
  const tokens = tokenize(source).filter((t) => t.kind !== "Comment");
  const eof = tokens[tokens.length - 1]!;
  const moduleRange: Range = {
    start: { offset: 0, line: 0, column: 0 },
    end: eof.range.end,
  };

  const entries: TopLevelEntry[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  /** `start` から論理行のトークンを集め、次の開始位置を返す。 */
  const collectLine = (start: number): { line: Token[]; next: number } => {
    let lineEnd = tokens[start]!.range.start.line;
    let end = start;
    while (
      end < tokens.length &&
      tokens[end]!.kind !== "Eof" &&
      tokens[end]!.range.start.line <= lineEnd
    ) {
      lineEnd = Math.max(lineEnd, tokens[end]!.range.end.line);
      end += 1;
    }
    return { line: tokens.slice(start, end), next: end };
  };

  /** `define` 以外のトップレベルエントリを、括弧が閉じる位置まで集める。 */
  const collectTopLevelEntry = (start: number): { line: Token[]; next: number } => {
    const line: Token[] = [];
    let next = start;
    let depth = 0;
    do {
      const collected = collectLine(next);
      line.push(...collected.line);
      for (const token of collected.line) {
        depth = updateDelimiterDepth(depth, token.value);
      }
      next = collected.next;
    } while (next < tokens.length && tokens[next]?.kind !== "Eof" && depth > 0);
    return { line, next };
  };

  /** `define` の本体（`{`...`}`）を読み、シグネチャ・本体・終端位置を返す。 */
  const collectFunction = (start: number): { signature: Token[]; body: Token[]; next: number } => {
    let open = start;
    let signatureDepth = 0;
    let sawFunctionName = false;
    while (open < tokens.length && tokens[open]?.kind !== "Eof") {
      const token = tokens[open];
      const value = token?.value;
      if (
        value === "{" &&
        signatureDepth === 0 &&
        sawFunctionName &&
        isFunctionBodyOpen(tokens, open)
      )
        break;
      if (token?.kind === "GlobalIdentifier") sawFunctionName = true;
      signatureDepth = updateTypeDelimiterDepth(signatureDepth, value);
      open += 1;
    }
    const signature = tokens.slice(start, open);
    if (tokens[open]?.value !== "{") {
      return { signature, body: [], next: open };
    }
    let depth = 1;
    let i = open + 1;
    for (; i < tokens.length && tokens[i]?.kind !== "Eof"; i += 1) {
      const value = tokens[i]?.value;
      if (value === "{") depth += 1;
      else if (value === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = tokens.slice(open + 1, i);
    const closed = tokens[i]?.value === "}";
    return { signature, body, next: closed ? i + 1 : i };
  };

  for (let pos = 0; pos < tokens.length && tokens[pos]?.kind !== "Eof"; ) {
    const head = tokens[pos]!;

    // `define` のみブロック単位、それ以外は括弧の閉じる位置まで集める。
    if (head.kind === "Keyword" && head.value === "define") {
      const { signature, body, next } = collectFunction(pos);
      const defines = findToken(signature, "GlobalIdentifier");
      const last = tokens[next - 1]!;
      const blocks = parseBlocks(body);
      entries.push({
        kind: "FunctionDefinition",
        defines: defines?.token
          ? makeRef(defines.token, undefined)
          : { kind: "GlobalRef", name: "", range: head.range },
        blocks,
        references: collectRefs(signature, defines?.index),
        range: spanOf(head, last),
      });
      if (tokens[next - 1]?.value !== "}") {
        diagnostics.push({
          range: spanOf(head, last),
          message: "関数本体の `}` が閉じていません",
          severity: "error",
        });
      }
      pos = Math.max(next, pos + 1);
      continue;
    }

    const { line, next } = collectTopLevelEntry(pos);
    const range = spanOf(head, tokens[next - 1]!);
    entries.push(parseLineEntry(head, line, range, diagnostics));
    pos = next;
  }

  const ast: Module = { kind: "Module", entries, range: moduleRange };
  return { ast, diagnostics };
};

/** 関数本体トークンを基本ブロック列へ分解する。`Label` で新ブロックを開始する。 */
const parseBlocks = (body: readonly Token[]): BasicBlock[] => {
  const blocks: BasicBlock[] = [];
  type Acc = {
    label?: IdentifierRef;
    instructions: Instruction[];
    debugRecords: DebugRecord[];
    directives: UseListOrderDirective[];
    first: Token;
    last: Token;
  };
  let current: Acc | undefined;

  const flush = (): void => {
    if (current === undefined) return;
    blocks.push({
      kind: "BasicBlock",
      ...(current.label ? { label: current.label } : {}),
      instructions: current.instructions,
      ...(current.debugRecords.length > 0 ? { debugRecords: current.debugRecords } : {}),
      ...(current.directives.length > 0 ? { directives: current.directives } : {}),
      range: spanOf(current.first, current.last),
    });
    current = undefined;
  };

  let i = 0;
  while (i < body.length) {
    const head = body[i]!;
    if (head.kind === "Label" || (head.kind === "String" && body[i + 1]?.value === ":")) {
      const { next } = collectLineIn(body, i);
      const lineLast = body[next - 1]!;
      flush();
      current = {
        label: { kind: "LabelRef", name: head.value, range: head.range },
        instructions: [],
        debugRecords: [],
        directives: [],
        first: head,
        last: lineLast,
      };
      i = next;
    } else if (head.kind === "DebugRecord") {
      const { record, next } = collectDebugRecordIn(body, i);
      const recordLast = body[next - 1]!;
      if (current === undefined) {
        current = {
          instructions: [],
          debugRecords: [],
          directives: [],
          first: head,
          last: recordLast,
        };
      }
      current.debugRecords.push(makeDebugRecord(record));
      current.last = recordLast;
      i = next;
    } else if (
      head.kind === "Keyword" &&
      (head.value === "uselistorder" || head.value === "uselistorder_bb")
    ) {
      const { element, next } = collectDelimitedElementIn(body, i);
      const elementLast = body[next - 1]!;
      if (current === undefined) {
        current = {
          instructions: [],
          debugRecords: [],
          directives: [],
          first: head,
          last: elementLast,
        };
      }
      current.directives.push(makeUseListOrderDirective(element));
      current.last = elementLast;
      i = next;
    } else {
      const { element, next } = collectDelimitedElementIn(body, i);
      const elementLast = body[next - 1]!;
      if (current === undefined) {
        current = {
          instructions: [],
          debugRecords: [],
          directives: [],
          first: head,
          last: elementLast,
        };
      }
      current.instructions.push(makeInstruction(element));
      current.last = elementLast;
      i = next;
    }
  }
  flush();
  return blocks;
};

/** 複数行要素を囲む区切り記号からネスト深さを更新する。 */
const updateDelimiterDepth = (depth: number, value: string): number => {
  if (value === "{" || value === "[" || value === "(" || value === "<") return depth + 1;
  if (value === "}" || value === "]" || value === ")" || value === ">") {
    return Math.max(0, depth - 1);
  }
  return depth;
};

/** 型構文を含む関数シグネチャ用に、山括弧も含めてネスト深さを更新する。 */
const updateTypeDelimiterDepth = (depth: number, value: string | undefined): number => {
  if (value === "{" || value === "[" || value === "(" || value === "<") return depth + 1;
  if (value === "}" || value === "]" || value === ")" || value === ">") {
    return Math.max(0, depth - 1);
  }
  return depth;
};

/**
 * `define` シグネチャ中の `{` が関数本体の開始かを判定する。
 *
 * `prefix { i32, i32 } { i32 1, i32 2 }` のような braced 型・定数は、
 * 中身が型や定数から始まるため本体として扱わない。
 */
const isFunctionBodyOpen = (tokens: readonly Token[], index: number): boolean => {
  const next = tokens[index + 1]!;
  if (next.kind === "Eof" || next.value === "}") return true;
  if (
    next.kind === "Identifier" ||
    next.kind === "Label" ||
    next.kind === "Opcode" ||
    next.kind === "DebugRecord"
  )
    return true;
  if (next.kind === "String" && tokens[index + 2]?.value === ":") return true;
  if (next.kind === "LocalIdentifier" && tokens[index + 2]?.value === "=") return true;
  return (
    next.kind === "Keyword" && (next.value === "uselistorder" || next.value === "uselistorder_bb")
  );
};

/** `body` 内の `start` から論理行のトークンを集める（本体用の行分割）。 */
const collectLineIn = (body: readonly Token[], start: number): { line: Token[]; next: number } => {
  let lineEnd = body[start]!.range.start.line;
  let end = start;
  while (end < body.length && body[end]!.range.start.line <= lineEnd) {
    lineEnd = Math.max(lineEnd, body[end]!.range.end.line);
    end += 1;
  }
  return { line: body.slice(start, end), next: end };
};

/** `#dbg_*` record を括弧が閉じるまで複数行にまたがって集める。 */
const collectDebugRecordIn = (
  body: readonly Token[],
  start: number,
): { record: Token[]; next: number } => {
  const record: Token[] = [];
  let next = start;
  let depth = 0;
  do {
    const collected = collectLineIn(body, next);
    record.push(...collected.line);
    for (const token of collected.line) {
      depth = updateDelimiterDepth(depth, token.value);
    }
    next = collected.next;
  } while (next < body.length && depth > 0);
  return { record, next };
};

/** 命令や directive を括弧が閉じるまで複数行にまたがって集める。 */
const collectDelimitedElementIn = (
  body: readonly Token[],
  start: number,
): { element: Token[]; next: number } => {
  const element: Token[] = [];
  let next = start;
  let depth = 0;
  do {
    const collected = collectLineIn(body, next);
    element.push(...collected.line);
    for (const token of collected.line) {
      depth = updateDelimiterDepth(depth, token.value);
    }
    next = collected.next;
  } while (next < body.length && (depth > 0 || isInstructionContinuation(element, body, next)));
  return { element, next };
};

/** `invoke` や `landingpad` の後続行が、同じ命令の継続句かを判定する。 */
const isInstructionContinuation = (
  current: readonly Token[],
  body: readonly Token[],
  next: number,
): boolean => {
  const opcode = instructionOpcode(current);
  const head = body[next];
  if (!opcode || !head) return false;
  if (head.kind === "Label" || head.kind === "DebugRecord") return false;
  if (head.kind === "String" && body[next + 1]?.value === ":") return false;
  if (opcode === "invoke") return head.value === "to" || head.value === "unwind";
  if (opcode === "callbr") return head.value === "to";
  if (opcode === "landingpad")
    return head.value === "cleanup" || head.value === "catch" || head.value === "filter";
  return false;
};

/** 1 要素分のトークンから命令ノードを作る（`line` は非空である前提）。 */
const makeInstruction = (line: readonly Token[]): Instruction => {
  const first = line[0] as Token;
  const last = line[line.length - 1]!;
  let result: IdentifierRef | undefined;
  let excludeIndex = -1;
  if (first.kind === "LocalIdentifier" && line[1]?.value === "=") {
    result = makeRef(first, undefined);
    excludeIndex = 0;
  }
  const opcode = findToken(line, "Opcode")?.token.value;
  return {
    kind: "Instruction",
    ...(result ? { result } : {}),
    ...(opcode ? { opcode } : {}),
    operands: collectRefs(line, excludeIndex),
    range: spanOf(first, last),
  };
};

/** 1 要素分のトークンから debug record ノードを作る。 */
const makeDebugRecord = (line: readonly Token[]): DebugRecord => {
  const first = line[0] as Token;
  const last = line[line.length - 1]!;
  return {
    kind: "DebugRecord",
    name: first.value,
    operands: collectRefs(line),
    range: spanOf(first, last),
  };
};

/** 関数本体に現れた use-list order directive を作る。 */
const makeUseListOrderDirective = (line: readonly Token[]): UseListOrderDirective => {
  const first = line[0] as Token;
  const last = line[line.length - 1]!;
  return {
    kind: "UseListOrderDirective",
    directive: first.value === "uselistorder_bb" ? "uselistorder_bb" : "uselistorder",
    references: collectRefs(line),
    range: spanOf(first, last),
  };
};

/** `define` 以外のトップレベルエントリを判別してノードを作る。 */
const parseLineEntry = (
  head: Token,
  line: readonly Token[],
  range: Range,
  diagnostics: ParseDiagnostic[],
): TopLevelEntry => {
  if (head.kind === "Keyword" && head.value === "source_filename") {
    const filename = firstString(line);
    return {
      kind: "SourceFilename",
      ...(filename ? { filename } : {}),
      references: collectRefs(line),
      range,
    };
  }

  if (head.kind === "Keyword" && head.value === "target") {
    const target = hasWord(line, "Keyword", "datalayout")
      ? "datalayout"
      : hasWord(line, "Keyword", "triple")
        ? "triple"
        : undefined;
    const value = firstString(line);
    return {
      kind: "TargetDefinition",
      ...(target ? { target } : {}),
      ...(value ? { value } : {}),
      references: collectRefs(line),
      range,
    };
  }

  if (head.kind === "Keyword" && head.value === "module" && hasWord(line, "Keyword", "asm")) {
    const value = firstString(line);
    return {
      kind: "ModuleAsm",
      ...(value ? { value } : {}),
      references: collectRefs(line),
      range,
    };
  }

  if (
    head.kind === "Keyword" &&
    (head.value === "uselistorder" || head.value === "uselistorder_bb")
  ) {
    return {
      kind: "UseListOrderDirective",
      directive: head.value,
      references: collectRefs(line),
      range,
    };
  }

  if (head.kind === "Keyword" && head.value === "declare") {
    const defines = findToken(line, "GlobalIdentifier");
    return {
      kind: "FunctionDeclaration",
      defines: defines ? makeRef(defines.token, undefined) : { kind: "GlobalRef", name: "", range },
      references: collectRefs(line, defines?.index),
      range,
    };
  }

  if (head.kind === "Keyword" && head.value === "attributes") {
    const defines = findToken(line, "AttributeGroup");
    return {
      kind: "AttributeGroupDefinition",
      defines: defines
        ? makeRef(defines.token, undefined)
        : { kind: "AttributeGroupRef", name: "", range },
      references: collectRefs(line, defines?.index),
      range,
    };
  }

  if (head.kind === "GlobalIdentifier") {
    return {
      kind: "GlobalVariable",
      defines: makeRef(head, undefined),
      references: collectRefs(line, 0),
      range,
    };
  }

  if (head.kind === "ComdatIdentifier") {
    return {
      kind: "ComdatDefinition",
      defines: makeRef(head, undefined),
      references: collectRefs(line, 0),
      range,
    };
  }

  if (head.kind === "LocalIdentifier") {
    return {
      kind: "TypeDefinition",
      defines: makeRef(head, undefined),
      references: collectRefs(line, 0),
      range,
    };
  }

  if (head.kind === "MetadataIdentifier") {
    return {
      kind: "MetadataDefinition",
      defines: makeRef(head, undefined),
      distinct: hasWord(line, "Keyword", "distinct"),
      references: collectRefs(line, 0),
      range,
    };
  }

  diagnostics.push({ range, message: "解釈できないトップレベル行です", severity: "error" });
  return { kind: "UnknownEntry", references: collectRefs(line), range };
};
