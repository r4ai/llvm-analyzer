import { describe, expect, it } from "vitest";

import { parseModule } from "./parser.ts";
import {
  IncrementalParserSession,
  updateParseResult,
  type IncrementalParseEdit,
} from "./incremental-parser.ts";

const editFor = (
  source: string,
  start: number,
  end: number,
  replacement: string,
): IncrementalParseEdit => ({
  range: {
    start: positionAt(source, start),
    end: positionAt(source, end),
  },
  newEnd: insertedEnd(positionAt(source, start), replacement),
});

const positionAt = (source: string, offset: number) => {
  const prefix = source.slice(0, offset);
  const line = prefix.split("\n").length - 1;
  const lineStart = prefix.lastIndexOf("\n") + 1;
  return { offset, line, column: offset - lineStart };
};

const insertedEnd = (
  start: ReturnType<typeof positionAt>,
  replacement: string,
): ReturnType<typeof positionAt> => {
  const lastLineBreak = replacement.lastIndexOf("\n");
  if (lastLineBreak < 0) {
    return {
      offset: start.offset + replacement.length,
      line: start.line,
      column: start.column + replacement.length,
    };
  }
  return {
    offset: start.offset + replacement.length,
    line: start.line + replacement.split("\n").length - 1,
    column: replacement.length - lastLineBreak - 1,
  };
};

describe("IncrementalParserSession", () => {
  const source = [
    "@before = global i32 0",
    "define i32 @edited(i32 %x) {",
    "entry:",
    "  %value = add i32 %x, 1",
    "  ret i32 %value",
    "}",
    "@after = global i32 0",
  ].join("\n");

  it("初回解析の結果と処理量を公開する", () => {
    const session = IncrementalParserSession.create(source);

    expect(session.result).toEqual(parseModule(source));
    expect(session.strategy).toBe("initial");
    expect(session.reparsedBytes).toBe(source.length);
  });

  it("同じソースへの更新では同じsessionを返す", () => {
    const session = IncrementalParserSession.create(source);
    const offset = source.indexOf("add");

    expect(session.update(source, editFor(source, offset, offset + 3, "add"))).toBe(session);
    expect(session.updateFromSource(source)).toBe(session);
    expect(session.replace(source)).toBe(session);
  });

  it("同じ長さの局所編集では対象要素だけを再パースする", () => {
    const session = IncrementalParserSession.create(source);
    const start = source.indexOf("add");
    const updatedSource = source.replace("add", "sub");

    const updated = session.update(updatedSource, editFor(source, start, start + 3, "sub"));

    expect(updated.strategy).toBe("incremental");
    expect(updated.reparsedBytes).toBeLessThan(source.length);
    expect(updated.result).toEqual(parseModule(updatedSource));
    expect(updated.result.ast.entries[0]).toBe(session.result.ast.entries[0]);
    expect(updated.result.ast.entries[2]).toBe(session.result.ast.entries[2]);
  });

  it("互換入口は全文から差分を推定して局所更新する", () => {
    const session = IncrementalParserSession.create(source);
    const updatedSource = source.replace("add", "sub");

    const updated = session.updateFromSource(updatedSource);

    expect(updated.strategy).toBe("incremental");
    expect(updated.result).toEqual(parseModule(updatedSource));
  });

  it("伸縮する局所編集では後続要素の位置を移す", () => {
    const session = IncrementalParserSession.create(source);
    const before = "%value = add i32 %x, 1";
    const replacement = "%longer = add i32 %x, 100\n  %value = add i32 %longer, 1";
    const start = source.indexOf(before);
    const updatedSource = source.replace(before, replacement);

    const updated = session.update(
      updatedSource,
      editFor(source, start, start + before.length, replacement),
    );

    expect(updated.strategy).toBe("incremental");
    expect(updated.result).toEqual(parseModule(updatedSource));
    expect(updated.result.ast.entries[2]).not.toBe(session.result.ast.entries[2]);
  });

  it("同じ行の終端位置を編集後の列へ移す", () => {
    const oneLineSource = "@value = global i32 0, align 4";
    const session = IncrementalParserSession.create(oneLineSource);
    const start = oneLineSource.indexOf("0");
    const updatedSource = oneLineSource.replace("0", "100");

    const updated = session.update(updatedSource, editFor(oneLineSource, start, start + 1, "100"));

    expect(updated.result).toEqual(parseModule(updatedSource));
  });

  it("要素境界をまたぐ編集は全文解析へ戻す", () => {
    const session = IncrementalParserSession.create(source);
    const marker = "\ndefine";
    const start = source.indexOf(marker);
    const replacement = "\n@g = global i32 0\ndefine";
    const updatedSource = source.replace(marker, replacement);

    const updated = session.update(
      updatedSource,
      editFor(source, start, start + marker.length, replacement),
    );

    expect(updated.strategy).toBe("full");
    expect(updated.reparsedBytes).toBe(updatedSource.length);
    expect(updated.result).toEqual(parseModule(updatedSource));
  });

  it("編集契約に反する位置は補正せず拒否する", () => {
    const session = IncrementalParserSession.create(source);
    const start = source.indexOf("add");
    const updatedSource = source.replace("add", "sub");
    const edit = editFor(source, start, start + 3, "sub");

    const invalidEdits: readonly IncrementalParseEdit[] = [
      {
        ...edit,
        range: {
          ...edit.range,
          end: { ...edit.range.end, offset: source.length + 1 },
        },
      },
      {
        ...edit,
        range: {
          start: { ...edit.range.start, offset: -1 },
          end: edit.range.end,
        },
      },
      {
        ...edit,
        range: {
          start: edit.range.end,
          end: edit.range.start,
        },
      },
      {
        ...edit,
        newEnd: { ...edit.newEnd, offset: edit.range.start.offset - 1 },
      },
    ];

    for (const invalid of invalidEdits) {
      expect(() => session.update(updatedSource, invalid)).toThrow(RangeError);
    }
    expect(() => session.update(`${updatedSource}x`, edit)).toThrow(RangeError);
  });
});

describe("updateParseResult", () => {
  it("ソースが同じなら前回結果をそのまま返す", () => {
    const source = "@g = global i32 0";
    const previous = parseModule(source);

    expect(updateParseResult(previous, source, source)).toBe(previous);
  });

  it("要素間の編集と空モジュールの編集は局所更新しない", () => {
    const source = "@a = global i32 0\n@b = global i32 0";
    const previous = parseModule(source);

    expect(updateParseResult(previous, source, source.replace("\n", "\n@g = global i32 0\n"))).toBe(
      undefined,
    );
    expect(updateParseResult(parseModule(""), "", " ")).toBe(undefined);
  });

  it("一つの要素が複数要素へ分かれる変更は局所更新しない", () => {
    const source = "define void @f() {\nentry:\n  ret void\n}";
    const previous = parseModule(source);
    const updated = source.replace("  ret void", "}\n@g = global i32 0\n; ret void");

    expect(updateParseResult(previous, source, updated)).toBe(undefined);
  });

  it("再パースした要素が変更範囲全体を覆わない場合は局所更新しない", () => {
    const source = "??? editable";
    const previous = parseModule(source);
    const updated = source.replace("editable", ";      e");

    expect(updateParseResult(previous, source, updated)).toBe(undefined);
  });

  it("位置が動く後続要素の全ノードと構文診断を移す", () => {
    const source = [
      "??? before",
      "define i32 @edited(i32 %x) {",
      "entry:",
      "  %value = add i32 %x, 1",
      "  ret i32 %value",
      "}",
      "define void @details(ptr %p) {",
      "  #dbg_value(ptr %p, !0, !DIExpression(), !1)",
      "entry:",
      "  uselistorder ptr %p, { 0 }",
      "  ret void",
      "}",
      "@g = global i32 0",
      "??? after",
    ].join("\n");
    const previous = parseModule(source);
    const updated = source.replace(
      "%value = add i32 %x, 1",
      "%longer = add i32 %x, 100\n  %value = add i32 %longer, 1",
    );

    const incremental = updateParseResult(previous, source, updated);
    const fresh = parseModule(updated);

    expect(incremental).toEqual(fresh);
    expect(incremental?.diagnostics).toHaveLength(2);
  });

  it("診断を持つUnknownEntryだけを再パースする", () => {
    const source = ["??? before", "??? editable", "??? after"].join("\n");
    const previous = parseModule(source);
    const updated = source.replace("editable", "changede");

    const incremental = updateParseResult(previous, source, updated);

    expect(incremental).toEqual(parseModule(updated));
    expect(incremental?.diagnostics).toHaveLength(3);
  });
});
