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

/** 一回の編集について、更新前の範囲と更新後の挿入終端を表す。 */
export interface IncrementalParseEdit {
  /** 更新前ソース上で置換する範囲。 */
  readonly range: Range;
  /** 更新後ソース上で、挿入されたテキストの直後を指す位置。 */
  readonly newEnd: Position;
}

/** parser sessionが直前のソースを処理した方法。 */
export type ParseUpdateStrategy = "initial" | "incremental" | "full";

interface IncrementalParseResult {
  readonly result: ParseResult;
  readonly reparsedBytes: number;
}

/**
 * LLVM IRソースと構文解析結果を所有する不変のparser session。
 *
 * @remarks
 * ソース長を`n`、トップレベル要素数を`m`、再パースする要素長を`k`、
 * 位置が移動する後続ASTノード数を`a_s`とする。
 * 初回解析は時間・空間とも`O(n)`である。
 * 同じ長さの局所編集は`O(log m + k + m)`時間、`O(k + m)`追加空間で処理する。
 * 長さまたは行数が変わる局所編集は`O(log m + k + m + a_s)`時間、
 * `O(k + m + a_s)`追加空間で処理する。
 * 要素境界を確定できない場合は`O(n)`の全文解析へ戻す。
 *
 * 公開ASTが絶対位置を持つ配列であるため、局所編集でも配列再構成の`O(m)`は残る。
 */
export class IncrementalParserSession {
  readonly source: string;
  readonly result: ParseResult;
  readonly strategy: ParseUpdateStrategy;
  readonly reparsedBytes: number;

  private constructor(
    source: string,
    result: ParseResult,
    strategy: ParseUpdateStrategy,
    reparsedBytes: number,
  ) {
    this.source = source;
    this.result = result;
    this.strategy = strategy;
    this.reparsedBytes = reparsedBytes;
  }

  /**
   * 全文から新しいsessionを作る。
   *
   * @param source LLVM IRソース。
   * @returns 初回解析済みのsession。
   */
  static create(source: string): IncrementalParserSession {
    return IncrementalParserSession.parseAll(source, "initial");
  }

  /**
   * 明示的な編集を適用した新しいsessionを返す。
   *
   * @param source 更新後のソース。
   * @param edit 更新前の範囲と更新後の挿入終端。
   * @returns 局所更新または安全な全文解析を行ったsession。
   * @throws {RangeError} 編集位置とソース長の契約が不正な場合。
   *
   * @remarks
   * `source`は、このsessionのソースへ`edit`を一回適用した結果でなければならない。
   * 呼び出し側が保証するこの前提により、変更範囲を全文走査で再検証しない。
   */
  update(source: string, edit: IncrementalParseEdit): IncrementalParserSession {
    if (source === this.source) return this;
    assertValidEdit(this.source, source, edit);
    const incremental = applyIncrementalEdit(this.result, source, edit);
    return incremental
      ? new IncrementalParserSession(
          source,
          incremental.result,
          "incremental",
          incremental.reparsedBytes,
        )
      : IncrementalParserSession.parseAll(source, "full");
  }

  /**
   * 更新前後の全文から差分を推定して更新する互換入口。
   *
   * @param source 更新後のソース。
   * @returns 局所更新または安全な全文解析を行ったsession。
   *
   * @remarks
   * 差分推定に`O(n)`時間を使う。
   * 明示的な編集範囲を持つ呼び出し側は{@link update}を使用する。
   */
  updateFromSource(source: string): IncrementalParserSession {
    if (source === this.source) return this;
    const change = changedRange(this.source, source);
    return this.update(source, {
      range: {
        start: positionAt(this.source, change.oldStart),
        end: positionAt(this.source, change.oldEnd),
      },
      newEnd: positionAt(source, change.newEnd),
    });
  }

  /**
   * 差分情報を利用できない全文変更として更新する。
   *
   * @param source 更新後のソース。
   * @returns 全文解析済みのsession。
   */
  replace(source: string): IncrementalParserSession {
    return source === this.source ? this : IncrementalParserSession.parseAll(source, "full");
  }

  private static parseAll(
    source: string,
    strategy: Exclude<ParseUpdateStrategy, "incremental">,
  ): IncrementalParserSession {
    return new IncrementalParserSession(source, parseModule(source), strategy, source.length);
  }
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
  return applyIncrementalEdit(previous, source, {
    range: {
      start: positionAt(previousSource, change.oldStart),
      end: positionAt(previousSource, change.oldEnd),
    },
    newEnd: positionAt(source, change.newEnd),
  })?.result;
};

const applyIncrementalEdit = (
  previous: ParseResult,
  source: string,
  edit: IncrementalParseEdit,
): IncrementalParseResult | undefined => {
  const entryIndex = containingEntryIndex(previous.ast.entries, edit.range);
  if (entryIndex < 0) return undefined;

  const oldEntry = previous.ast.entries[entryIndex]!;
  const offsetDelta = edit.newEnd.offset - edit.range.end.offset;
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
  const positionChange = makePositionChange(edit.range.end, edit.newEnd);
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

  const result = {
    ast: {
      kind: "Module",
      range: {
        start: { offset: 0, line: 0, column: 0 },
        end: shiftModuleEnd(previous.ast.range.end, positionChange),
      },
      entries: [...prefix, shiftedReplacement, ...suffix],
    },
    diagnostics,
  } satisfies ParseResult;
  return { result, reparsedBytes: fragment.length };
};

const containingEntryIndex = (entries: readonly TopLevelEntry[], range: Range): number => {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const entry = entries[middle]!;
    if (range.start.offset <= entry.range.start.offset) {
      high = middle - 1;
    } else if (range.start.offset >= entry.range.end.offset) {
      low = middle + 1;
    } else if (range.end.offset >= entry.range.end.offset) {
      return -1;
    } else {
      return middle;
    }
  }
  return -1;
};

const assertValidEdit = (
  previousSource: string,
  source: string,
  edit: IncrementalParseEdit,
): void => {
  const { start, end } = edit.range;
  const positions = [start, end, edit.newEnd];
  if (
    positions.some((position) => Math.min(position.offset, position.line, position.column) < 0) ||
    start.offset > end.offset ||
    end.offset > previousSource.length ||
    edit.newEnd.offset < start.offset ||
    source.length !==
      previousSource.length - (end.offset - start.offset) + (edit.newEnd.offset - start.offset)
  ) {
    throw new RangeError("編集位置がソース長の契約と一致しません。");
  }
};

interface TextChange {
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly newEnd: number;
}

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

const makePositionChange = (oldEnd: Position, newEnd: Position): PositionChange => {
  const offsetDelta = newEnd.offset - oldEnd.offset;
  const lineDelta = newEnd.line - oldEnd.line;
  const columnDelta = newEnd.column - oldEnd.column;
  return {
    isIdentity: offsetDelta === 0 && lineDelta === 0 && columnDelta === 0,
    shiftSuffix: (position) => ({
      offset: position.offset + offsetDelta,
      line: position.line + lineDelta,
      column: position.line === oldEnd.line ? position.column + columnDelta : position.column,
    }),
  };
};

const shiftModuleEnd = (end: Position, change: PositionChange): Position =>
  change.isIdentity ? end : change.shiftSuffix(end);

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
