/**
 * LLVM IR の再帰下降パーサ。lexer の出力するトークン列を AST へ組み立てる純粋関数。
 *
 * 粒度は「構造重視・命令は粗く」（[plan](../../../../docs/plans/2026-06-22-parser-ast.md) 参照）。
 * トップレベル構造は型付きノードに分解するが、命令や型の内部は構造化せず、出現する識別子参照を
 * 収集するにとどめる。`define` 本体は `{`...`}` ブロックとして走査し、それ以外のトップレベルは
 * 通常行単位だが、括弧が複数行にまたがる場合は閉じるまで 1 エントリとして集める。
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
const REF_KIND: Record<string, IdentifierRef["kind"]> = {
  GlobalIdentifier: "GlobalRef",
  LocalIdentifier: "LocalRef",
  MetadataIdentifier: "MetadataRef",
  AttributeGroup: "AttributeGroupRef",
  ComdatIdentifier: "ComdatRef",
};

/** `start`/`end` トークンから範囲を作る（半開区間）。 */
const spanOf = (start: Token, end: Token): Range => ({
  start: start.range.start,
  end: end.range.end,
});

/**
 * 識別子トークンを参照ノードへ変換する。
 * `label %x` の `%x` のように直前が型キーワード `label` の場合は {@link IdentifierRef} を `LabelRef` とする。
 */
const makeRef = (token: Token, prev: Token | undefined): IdentifierRef => {
  const base = REF_KIND[token.kind] ?? "LocalRef";
  const kind =
    token.kind === "LocalIdentifier" && prev?.kind === "Type" && prev.value === "label"
      ? "LabelRef"
      : base;
  return { kind, name: token.value, range: token.range };
};

/**
 * トークン列に現れる識別子参照を収集する。
 * `excludeIndex` の位置（そのエントリが定義する名前など）は除外する。
 */
const collectRefs = (tokens: readonly Token[], excludeIndex = -1): IdentifierRef[] => {
  const refs: IdentifierRef[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (i === excludeIndex || token === undefined) continue;
    if (IDENTIFIER_KINDS.has(token.kind)) refs.push(makeRef(token, tokens[i - 1]));
  }
  return refs;
};

/** トークン列から、指定種別の最初のトークンとその位置を探す。 */
const findToken = (
  tokens: readonly Token[],
  kind: Token["kind"],
): { token: Token; index: number } | undefined => {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token?.kind === kind) return { token, index: i };
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
  const eof = tokens[tokens.length - 1];
  const moduleRange: Range = {
    start: { offset: 0, line: 0, column: 0 },
    end: eof?.range.end ?? { offset: 0, line: 0, column: 0 },
  };

  const entries: TopLevelEntry[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  /** `start` から同一行のトークンを集め、次の開始位置を返す。 */
  const collectLine = (start: number): { line: Token[]; next: number } => {
    const lineNo = tokens[start]?.range.start.line;
    let end = start;
    while (
      end < tokens.length &&
      tokens[end]?.kind !== "Eof" &&
      tokens[end]?.range.start.line === lineNo
    ) {
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
    while (open < tokens.length && tokens[open]?.kind !== "Eof" && tokens[open]?.value !== "{") {
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
    const head = tokens[pos];
    if (head === undefined) break;

    // `define` のみブロック単位、それ以外は括弧の閉じる位置まで集める。
    if (head.kind === "Keyword" && head.value === "define") {
      const { signature, body, next } = collectFunction(pos);
      const defines = findToken(signature, "GlobalIdentifier");
      const last = tokens[next - 1] ?? head;
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
    const range = spanOf(head, tokens[next - 1] ?? head);
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
      range: spanOf(current.first, current.last),
    });
    current = undefined;
  };

  let i = 0;
  while (i < body.length) {
    const head = body[i];
    if (head === undefined) break;
    const { line, next } = collectLineIn(body, i);
    const lineLast = body[next - 1] ?? head;
    if (head.kind === "Label") {
      flush();
      current = {
        label: { kind: "LabelRef", name: head.value, range: head.range },
        instructions: [],
        debugRecords: [],
        first: head,
        last: lineLast,
      };
    } else if (head.kind === "DebugRecord") {
      if (current === undefined) {
        current = { instructions: [], debugRecords: [], first: head, last: lineLast };
      }
      current.debugRecords.push(makeDebugRecord(line));
      current.last = lineLast;
    } else {
      if (current === undefined) {
        current = { instructions: [], debugRecords: [], first: head, last: lineLast };
      }
      current.instructions.push(makeInstruction(line));
      current.last = lineLast;
    }
    i = next;
  }
  flush();
  return blocks;
};

/** 括弧トークンからネスト深さを更新する。 */
const updateDelimiterDepth = (depth: number, value: string): number => {
  if (value === "{" || value === "[" || value === "(") return depth + 1;
  if (value === "}" || value === "]" || value === ")") return Math.max(0, depth - 1);
  return depth;
};

/** `body` 内の `start` から同一行のトークンを集める（本体用の行分割）。 */
const collectLineIn = (body: readonly Token[], start: number): { line: Token[]; next: number } => {
  const lineNo = body[start]?.range.start.line;
  let end = start;
  while (end < body.length && body[end]?.range.start.line === lineNo) end += 1;
  return { line: body.slice(start, end), next: end };
};

/** 1 行分のトークンから命令ノードを作る（`line` は非空である前提）。 */
const makeInstruction = (line: readonly Token[]): Instruction => {
  const first = line[0] as Token;
  const last = line[line.length - 1] ?? first;
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

/** 1 行分のトークンから debug record ノードを作る。 */
const makeDebugRecord = (line: readonly Token[]): DebugRecord => {
  const first = line[0] as Token;
  const last = line[line.length - 1] ?? first;
  return {
    kind: "DebugRecord",
    name: first.value,
    operands: collectRefs(line),
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
    return {
      kind: "SourceFilename",
      ...(firstString(line) ? { filename: firstString(line) } : {}),
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
    return {
      kind: "TargetDefinition",
      ...(target ? { target } : {}),
      ...(firstString(line) ? { value: firstString(line) } : {}),
      references: collectRefs(line),
      range,
    };
  }

  if (head.kind === "Keyword" && head.value === "module" && hasWord(line, "Keyword", "asm")) {
    return {
      kind: "ModuleAsm",
      ...(firstString(line) ? { value: firstString(line) } : {}),
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
