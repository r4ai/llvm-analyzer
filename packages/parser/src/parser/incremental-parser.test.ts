import { describe, expect, it } from "vitest";

import { parseModule } from "./parser.ts";
import { updateParseResult } from "./incremental-parser.ts";

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
