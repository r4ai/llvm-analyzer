/**
 * LLVM IR 命令や引数から SSA 値の型を推定するヘルパー群。
 *
 * @remarks
 * parser/type パッケージの字句解析と型パーサだけに依存する純粋関数で、
 * analyzer 本体のスコープやシンボルといった可変状態には触れない。
 * inlay hint や hover で「行内のソース断片から軽量に型を読む」用途に絞り、
 * datalayout 依存の厳密な型計算は対象外とする。
 */
import { formatLlvmType, parseLlvmType, tokenize } from "@llvm-analyzer/parser";
import type { IdentifierRef, Instruction, Token } from "@llvm-analyzer/parser";

/** 結果型が「変換先の型」になる変換系 opcode。 */
const CONVERSION_OPCODES = new Set([
  "trunc",
  "zext",
  "sext",
  "fptrunc",
  "fpext",
  "fptoui",
  "fptosi",
  "uitofp",
  "sitofp",
  "ptrtoint",
  "inttoptr",
  "ptrtoaddr",
  "bitcast",
  "addrspacecast",
]);

/** 先頭オペランド型からは結果型が決まらず、opcode 固有規則を要する opcode。 */
const SPECIAL_RESULT_OPCODES = new Set([
  "select",
  "extractelement",
  "extractvalue",
  "cmpxchg",
  "atomicrmw",
]);

/** 正規表現に安全に埋め込めるよう、メタ文字をエスケープする。 */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * 命令結果の型を推定する。
 *
 * @param source `parseModule` に渡したものと同じ元ソース。
 * @param instruction 型を推定する命令。
 * @returns 推定できた LLVM IR 型。推定できない場合は undefined。
 *
 * @remarks
 * parser は命令内部を構造化しないため、ここでは元ソースの命令行からオペコード直後の型構文を切り出す。
 * 切り出した断片は parser の型パーサで検証し、読めた範囲だけを表示用の型として返す。
 */
export const inferInstructionResultType = (
  source: string | undefined,
  instruction: Instruction,
): string | undefined => {
  if (!source || !instruction.opcode) return undefined;
  if (instruction.opcode === "alloca" || instruction.opcode === "getelementptr") return "ptr";
  const line = source.slice(instruction.range.start.offset, instruction.range.end.offset);
  const opcodeMatch = new RegExp(`(?:^|[\\s=])${escapeRegExp(instruction.opcode)}\\b`, "u").exec(
    line,
  );
  if (!opcodeMatch) return undefined;
  const afterOpcode = line.slice(opcodeMatch.index + opcodeMatch[0].length);
  if (instruction.opcode === "icmp" || instruction.opcode === "fcmp")
    return compareResultType(afterOpcode);
  if (CONVERSION_OPCODES.has(instruction.opcode)) {
    const toIndex = indexOfWord(afterOpcode, "to");
    if (toIndex < 0) return undefined;
    return leadingTypeText(afterOpcode.slice(toIndex + "to".length));
  }
  const specificType = inferInstructionResultTypeByOpcode(instruction.opcode, afterOpcode);
  if (SPECIAL_RESULT_OPCODES.has(instruction.opcode)) return specificType;
  if (specificType !== undefined) return specificType;
  return firstTypeText(afterOpcode);
};

/**
 * opcode 固有の結果型規則を適用する。
 *
 * @param opcode 命令 opcode。
 * @param afterOpcode opcode 直後から命令末尾までのソース断片。
 * @returns opcode 固有規則で分かる結果型。未対応なら undefined。
 */
const inferInstructionResultTypeByOpcode = (
  opcode: string,
  afterOpcode: string,
): string | undefined => {
  const tokens = tokenize(afterOpcode).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  const segments = splitTopLevelSegments(tokens);
  switch (opcode) {
    case "select":
      return leadingTypeOf(segments[1] ?? []);
    case "extractelement":
      return elementTypeOfVector(leadingTypeOf(segments[0] ?? []));
    case "extractvalue":
      return indexedAggregateElementType(leadingTypeOf(segments[0] ?? []), segments[1] ?? []);
    case "cmpxchg": {
      const valueType = leadingTypeOf(segments[1] ?? []);
      return valueType ? `{ ${valueType}, i1 }` : undefined;
    }
    case "atomicrmw":
      return inferAtomicRmwResultType(tokens);
    default:
      return undefined;
  }
};

/** top-level の `,` でトークン列を分割する。 */
const splitTopLevelSegments = (tokens: readonly Token[]): readonly Token[][] => {
  const segments: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === "," && depth === 0) {
      segments.push(current);
      current = [];
      continue;
    }
    current.push(token);
    depth = updateTypeDepth(depth, token.value);
    if (token.value === "(") depth += 1;
    else if (token.value === ")") depth = Math.max(0, depth - 1);
  }
  segments.push(current);
  return segments;
};

/** ベクトル型の要素型を取り出す。 */
const elementTypeOfVector = (type: string | undefined): string | undefined => {
  if (!type) return undefined;
  const match = /^<\s*(?:vscale x\s*)?\d+ x (?<element>.+)>$/u.exec(type);
  return match?.groups?.element;
};

/** 単純な struct / array から extractvalue の単一 index 結果型を取り出す。 */
const indexedAggregateElementType = (
  aggregateType: string | undefined,
  indexSegment: readonly Token[],
): string | undefined => {
  if (!aggregateType) return undefined;
  const indexToken = indexSegment.find((token) => /^\d+$/u.test(token.value));
  if (!indexToken) return undefined;
  const index = Number.parseInt(indexToken.value, 10);
  if (!Number.isInteger(index) || index < 0) return undefined;
  const elements = aggregateElementTypes(aggregateType);
  return elements[index];
};

/** 表示用に整形済みの集約型文字列から top-level の要素型を分割する。 */
const aggregateElementTypes = (type: string): readonly string[] => {
  const structMatch = /^\{ (?<body>.*) \}$/u.exec(type) ?? /^<\{ (?<body>.*) \}>$/u.exec(type);
  if (structMatch?.groups?.body !== undefined)
    return splitTopLevelTypeText(structMatch.groups.body);
  const arrayMatch = /^\[(?<count>\d+) x (?<element>.+)\]$/u.exec(type);
  if (arrayMatch?.groups?.element !== undefined) return [arrayMatch.groups.element];
  return [];
};

/** top-level の `,` で型文字列を分割する。 */
const splitTopLevelTypeText = (source: string): readonly string[] => {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of source) {
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
    if (char === "{" || char === "[" || char === "<" || char === "(") depth += 1;
    else if (char === "}" || char === "]" || char === ">" || char === ")")
      depth = Math.max(0, depth - 1);
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
};

/** atomicrmw は演算名の後にポインタ operand と値 operand が続く。 */
const inferAtomicRmwResultType = (tokens: readonly Token[]): string | undefined => {
  const segments = splitTopLevelSegments(tokens);
  return leadingTypeOf(segments[1] ?? []);
};

/** `icmp` / `fcmp` の結果型を、スカラーまたは vector lane ごとの `i1` として推定する。 */
const compareResultType = (afterOpcode: string): string => {
  const comparedType = firstTypeText(afterOpcode);
  const vector = vectorShape(comparedType);
  return vector ? `<${vector.scalable ? "vscale x " : ""}${vector.length} x i1>` : "i1";
};

const vectorShape = (
  type: string | undefined,
): { readonly scalable: boolean; readonly length: number } | undefined => {
  if (!type) return undefined;
  const matched = /^<(?<scalable>vscale x )?(?<length>\d+) x .+>$/u.exec(type);
  const length = matched?.groups?.length ? Number.parseInt(matched.groups.length, 10) : undefined;
  if (length === undefined) return undefined;
  return { scalable: matched?.groups?.scalable !== undefined, length };
};

/**
 * 識別子の直前にある型トークンを推定する。
 *
 * @param source `parseModule` に渡したものと同じ元ソース。
 * @param ref 型を推定する識別子出現。
 * @returns 識別子直前の型トークン。推定できない場合は undefined。
 *
 * @remarks
 * 主な用途は関数引数 `i32 %x` の型取得。
 * 行頭から識別子直前までだけを見るため、別行の型や複雑な属性列には踏み込まない。
 */
export const inferTypeBefore = (
  source: string | undefined,
  ref: IdentifierRef,
): string | undefined => {
  if (!source) return undefined;
  const lineStart = source.lastIndexOf("\n", Math.max(0, ref.range.start.offset - 1)) + 1;
  const before = source.slice(lineStart, ref.range.start.offset);
  return inferLeadingParameterType(before) ?? trailingTypeText(before);
};

/**
 * 関数引数の先頭型を、現在の引数セグメントから推定する。
 *
 * @param before 行頭から識別子直前までのソース断片。
 * @returns `ptr addrspace(1)` や `%T` などの先頭型。推定できなければ undefined。
 *
 * @remarks
 * `ptr addrspace(N) %p` では識別子直前の最後のトークンが `)` になるため、単純な「直前トークン」では
 * 型を取れない。ここでは関数呼び出し/宣言の括弧深さを見て、現在の引数セグメント先頭を読む。
 */
const inferLeadingParameterType = (before: string): string | undefined => {
  const tokens = tokenize(before).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  let parenDepth = 0;
  let typeDepth = 0;
  let segmentStart = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token.value === "(" && typeDepth === 0) {
      parenDepth += 1;
      if (parenDepth === 1) segmentStart = i + 1;
      continue;
    }
    if (token.value === ")" && typeDepth === 0) {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (token.value === "," && parenDepth === 1 && typeDepth === 0) {
      segmentStart = i + 1;
      continue;
    }
    if (parenDepth >= 1) typeDepth = updateTypeDepth(typeDepth, token.value);
  }
  const segment = tokens.slice(segmentStart);
  return leadingTypeOf(segment);
};

/** 引数セグメントの先頭から、この analyzer が安全に扱える型だけを取り出す。 */
const leadingTypeOf = (tokens: readonly Token[]): string | undefined => {
  const first = tokens.findIndex((token) => token.kind !== "Comment");
  if (first < 0) return undefined;
  return leadingTypeTextFromTokens(tokens.slice(first));
};

/** 文字列断片の先頭から、型パーサが読める型だけを取り出す。 */
const leadingTypeText = (source: string): string | undefined =>
  leadingTypeTextFromTokens(
    tokenize(source).filter((token) => token.kind !== "Eof" && token.kind !== "Comment"),
  );

/** 命令フラグや呼出規約を飛ばし、最初に読める型構文を取り出す。 */
const firstTypeText = (source: string): string | undefined =>
  firstTypeTextFromTokens(
    tokenize(source).filter((token) => token.kind !== "Eof" && token.kind !== "Comment"),
  );

const firstTypeTextFromTokens = (tokens: readonly Token[]): string | undefined => {
  for (let start = 0; start < tokens.length; start += 1) {
    const type = leadingTypeTextFromTokens(tokens.slice(start));
    if (type) return type;
  }
  return undefined;
};

/** トークン列の先頭から、型パーサが読める型だけを取り出す。 */
const leadingTypeTextFromTokens = (tokens: readonly Token[]): string | undefined => {
  const candidates = candidateTypeTexts(tokens);
  for (let length = candidates.length; length > 0; length -= 1) {
    const source = candidates.slice(0, length).join(" ");
    const parsed = parseLlvmType(source);
    const formatted = formatLlvmType(parsed.type);
    if (formatted && parsed.diagnostics.length === 0) return formatted;
  }
  return undefined;
};

/** 識別子直前の文字列断片末尾から、型パーサが読める型だけを取り出す。 */
const trailingTypeText = (source: string): string | undefined => {
  const tokens = tokenize(source).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  const candidates = candidateTypeTexts(tokens);
  for (let start = Math.max(0, candidates.length - 8); start < candidates.length; start += 1) {
    const parsed = parseLlvmType(candidates.slice(start).join(" "));
    const formatted = formatLlvmType(parsed.type);
    if (formatted && parsed.diagnostics.length === 0) return formatted;
  }
  return undefined;
};

/** 型候補のトークン値列。アライメントなど型でない後続属性に当たったら止める。 */
const candidateTypeTexts = (tokens: readonly Token[]): string[] => {
  const values: string[] = [];
  let square = 0;
  let paren = 0;
  let brace = 0;
  let angle = 0;
  for (const token of tokens) {
    if (token.value === "," && square === 0 && paren === 0 && brace === 0 && angle === 0) break;
    if (token.kind === "GlobalIdentifier" || token.kind === "AttributeGroup") break;
    if (
      values.length > 0 &&
      square === 0 &&
      paren === 0 &&
      brace === 0 &&
      angle === 0 &&
      token.kind === "LocalIdentifier"
    ) {
      break;
    }
    values.push(token.value);
    if (token.value === "[") square += 1;
    else if (token.value === "]") square = Math.max(0, square - 1);
    else if (token.value === "(") paren += 1;
    else if (token.value === ")") paren = Math.max(0, paren - 1);
    else if (token.value === "{") brace += 1;
    else if (token.value === "}") brace = Math.max(0, brace - 1);
    else if (token.value === "<") angle += 1;
    else if (token.value === ">") angle = Math.max(0, angle - 1);
  }
  return values;
};

/** 型構文内の区切りを値・引数の区切りと誤認しないための深さ更新。 */
const updateTypeDepth = (depth: number, value: string): number => {
  if (value === "{" || value === "[" || value === "<") return depth + 1;
  if (value === "}" || value === "]" || value === ">") return Math.max(0, depth - 1);
  return depth;
};

/** 単語境界を見てキーワードの位置を探す。 */
const indexOfWord = (source: string, word: string): number => {
  const match = new RegExp(String.raw`(?:^|\s)${escapeRegExp(word)}(?:\s|$)`, "u").exec(source);
  return match ? match.index + match[0].indexOf(word) : -1;
};
