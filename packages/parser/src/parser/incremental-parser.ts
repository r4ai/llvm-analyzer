import type {
  BasicBlock,
  DebugRecord,
  IdentifierRef,
  Instruction,
  ParseDiagnostic,
  ParseResult,
  TopLevelEntry,
  UseListOrderDirective,
} from "../ast/index.ts";
import type { Position, Range } from "../lexer/index.ts";
import { parseModule } from "./parser.ts";

interface TextChange {
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly newEnd: number;
}

/**
 * 前回の構文解析結果から、単一トップレベル要素内の変更だけを再パースする。
 *
 * @param previous 前回の {@link parseModule} の結果。
 * @param previousSource `previous` を作成した元ソース。
 * @param source 更新後のソース。
 * @returns 安全に局所更新できた結果。境界を確定できない場合は `undefined`。
 *
 * @remarks
 * 変更範囲が一つのトップレベル要素の内側へ厳密に収まる場合だけ局所更新する。
 * 関数の閉じ括弧を消す変更や要素間への挿入は、呼び出し側が全体パースへ戻せるように
 * `undefined` を返す。
 */
export const updateParseResult = (
  previous: ParseResult,
  previousSource: string,
  source: string,
): ParseResult | undefined => {
  if (previousSource === source) return previous;
  const change = changedRange(previousSource, source);
  const entryIndex = previous.ast.entries.findIndex(
    (entry) => change.oldStart > entry.range.start.offset && change.oldEnd < entry.range.end.offset,
  );
  if (entryIndex < 0) return undefined;

  const oldEntry = previous.ast.entries[entryIndex]!;
  const offsetDelta = source.length - previousSource.length;
  const newEntryEnd = oldEntry.range.end.offset + offsetDelta;

  const fragment = source.slice(oldEntry.range.start.offset, newEntryEnd);
  const parsedFragment = parseModule(fragment);
  if (parsedFragment.ast.entries.length !== 1) return undefined;
  const replacement = parsedFragment.ast.entries[0]!;
  if (replacement.range.start.offset !== 0 || replacement.range.end.offset !== fragment.length) {
    return undefined;
  }

  const base = oldEntry.range.start;
  const shiftedReplacement = shiftEntry(replacement, (position) =>
    shiftFromFragment(position, base),
  );
  const positionChange = makePositionChange(previousSource, source, change);
  const prefix = previous.ast.entries.slice(0, entryIndex);
  const suffix = previous.ast.entries
    .slice(entryIndex + 1)
    .map((entry) =>
      positionChange.isIdentity ? entry : shiftEntry(entry, positionChange.shiftSuffix),
    );
  const diagnostics = mergeDiagnostics(
    previous.diagnostics,
    parsedFragment.diagnostics,
    oldEntry.range,
    base,
    positionChange,
  );

  return {
    ast: {
      kind: "Module",
      range: {
        start: { offset: 0, line: 0, column: 0 },
        end: positionAt(source, source.length),
      },
      entries: [...prefix, shiftedReplacement, ...suffix],
    },
    diagnostics,
  };
};

const changedRange = (previous: string, source: string): TextChange => {
  const sharedLimit = Math.min(previous.length, source.length);
  let oldStart = 0;
  while (oldStart < sharedLimit && previous.charCodeAt(oldStart) === source.charCodeAt(oldStart)) {
    oldStart += 1;
  }

  let sharedSuffix = 0;
  const suffixLimit = sharedLimit - oldStart;
  while (
    sharedSuffix < suffixLimit &&
    previous.charCodeAt(previous.length - sharedSuffix - 1) ===
      source.charCodeAt(source.length - sharedSuffix - 1)
  ) {
    sharedSuffix += 1;
  }
  return {
    oldStart,
    oldEnd: previous.length - sharedSuffix,
    newEnd: source.length - sharedSuffix,
  };
};

interface PositionChange {
  readonly isIdentity: boolean;
  readonly shiftSuffix: (position: Position) => Position;
}

const makePositionChange = (
  previous: string,
  source: string,
  change: TextChange,
): PositionChange => {
  const oldEnd = positionAt(previous, change.oldEnd);
  const newEnd = positionAt(source, change.newEnd);
  const offsetDelta = source.length - previous.length;
  const lineDelta = newEnd.line - oldEnd.line;
  return {
    isIdentity: offsetDelta === 0 && lineDelta === 0,
    shiftSuffix: (position) => ({
      offset: position.offset + offsetDelta,
      line: position.line + lineDelta,
      column: position.column,
    }),
  };
};

const positionAt = (source: string, offset: number): Position => {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) !== 10) continue;
    line += 1;
    lineStart = index + 1;
  }
  return { offset, line, column: offset - lineStart };
};

const shiftFromFragment = (position: Position, base: Position): Position => ({
  offset: position.offset + base.offset,
  line: position.line + base.line,
  column: position.line === 0 ? position.column + base.column : position.column,
});

const mergeDiagnostics = (
  previous: readonly ParseDiagnostic[],
  fragment: readonly ParseDiagnostic[],
  replacedRange: Range,
  base: Position,
  positionChange: PositionChange,
): ParseDiagnostic[] => [
  ...previous.filter((diagnostic) => diagnostic.range.end.offset <= replacedRange.start.offset),
  ...fragment.map((diagnostic) =>
    shiftDiagnostic(diagnostic, (position) => shiftFromFragment(position, base)),
  ),
  ...previous
    .filter((diagnostic) => diagnostic.range.start.offset >= replacedRange.end.offset)
    .map((diagnostic) =>
      positionChange.isIdentity
        ? diagnostic
        : shiftDiagnostic(diagnostic, positionChange.shiftSuffix),
    ),
];

const shiftDiagnostic = (
  diagnostic: ParseDiagnostic,
  shift: (position: Position) => Position,
): ParseDiagnostic => ({
  ...diagnostic,
  range: shiftRange(diagnostic.range, shift),
});

const shiftEntry = (
  entry: TopLevelEntry,
  shift: (position: Position) => Position,
): TopLevelEntry => {
  const common = {
    ...entry,
    range: shiftRange(entry.range, shift),
    references: entry.references.map((reference) => shiftRef(reference, shift)),
    ...(entry.defines ? { defines: shiftRef(entry.defines, shift) } : {}),
  };
  if (entry.kind !== "FunctionDefinition") return common as TopLevelEntry;
  return {
    ...common,
    kind: "FunctionDefinition",
    defines: shiftRef(entry.defines, shift),
    blocks: entry.blocks.map((block) => shiftBlock(block, shift)),
  };
};

const shiftBlock = (block: BasicBlock, shift: (position: Position) => Position): BasicBlock => ({
  ...block,
  range: shiftRange(block.range, shift),
  ...(block.label ? { label: shiftRef(block.label, shift) } : {}),
  instructions: block.instructions.map((instruction) => shiftInstruction(instruction, shift)),
  ...(block.debugRecords
    ? { debugRecords: block.debugRecords.map((record) => shiftDebugRecord(record, shift)) }
    : {}),
  ...(block.directives
    ? { directives: block.directives.map((directive) => shiftDirective(directive, shift)) }
    : {}),
});

const shiftInstruction = (
  instruction: Instruction,
  shift: (position: Position) => Position,
): Instruction => ({
  ...instruction,
  range: shiftRange(instruction.range, shift),
  ...(instruction.result ? { result: shiftRef(instruction.result, shift) } : {}),
  operands: instruction.operands.map((operand) => shiftRef(operand, shift)),
});

const shiftDebugRecord = (
  record: DebugRecord,
  shift: (position: Position) => Position,
): DebugRecord => ({
  ...record,
  range: shiftRange(record.range, shift),
  operands: record.operands.map((operand) => shiftRef(operand, shift)),
});

const shiftDirective = (
  directive: UseListOrderDirective,
  shift: (position: Position) => Position,
): UseListOrderDirective => ({
  ...directive,
  range: shiftRange(directive.range, shift),
  references: directive.references.map((reference) => shiftRef(reference, shift)),
});

const shiftRef = (
  reference: IdentifierRef,
  shift: (position: Position) => Position,
): IdentifierRef => ({
  ...reference,
  range: shiftRange(reference.range, shift),
});

const shiftRange = (range: Range, shift: (position: Position) => Position): Range => ({
  start: shift(range.start),
  end: shift(range.end),
});
