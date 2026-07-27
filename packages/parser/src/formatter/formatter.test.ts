import { describe, expect, it } from "vitest";
import { parseModule } from "../parser/index.ts";
import { formatLlvmIr, formatLlvmIrFragment } from "./formatter.ts";

describe("formatLlvmIr", () => {
  it("トップレベル行を左詰めし、関数内の命令だけを2スペース字下げする", () => {
    const source = [
      '  source_filename = "main.c"  ',
      " define i32 @main() {",
      "entry:",
      "%sum = add i32 1, 2  ",
      "   ret i32 %sum",
      "  }",
      "",
    ].join("\n");

    expect(formatLlvmIr(source)).toBe(
      [
        'source_filename = "main.c"',
        "define i32 @main() {",
        "entry:",
        "  %sum = add i32 1, 2",
        "  ret i32 %sum",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("整形後も代表ノードの構造を維持する", () => {
    const source = [" define void @f() {", "entry:", "ret void", "}"].join("\n");
    const before = parseModule(source).ast.entries.map((entry) => entry.kind);
    const after = parseModule(formatLlvmIr(source)).ast.entries.map((entry) => entry.kind);

    expect(after).toEqual(before);
  });

  it("空行とコメント行を安全に扱う", () => {
    const source = ["define void @f() {", "entry:", "   ; comment", "", "ret void", "}"].join("\n");

    expect(formatLlvmIr(source)).toBe(
      ["define void @f() {", "entry:", "  ; comment", "", "  ret void", "}"].join("\n"),
    );
  });

  it("関数開始行の後ろにコメントがあっても本体を字下げする", () => {
    const source = ["define void @f() { ; comment", "entry:", "ret void", "}"].join("\n");

    expect(formatLlvmIr(source)).toBe(
      ["define void @f() { ; comment", "entry:", "  ret void", "}"].join("\n"),
    );
  });

  it("関数本体の途中から切り出した断片だけを整形する", () => {
    const source = [
      "%value = add i32 1, 2",
      "exit:",
      "ret i32 %value",
      "}",
      "@g = global i32 0",
    ].join("\n");

    expect(formatLlvmIrFragment(source, true)).toBe(
      ["  %value = add i32 1, 2", "exit:", "  ret i32 %value", "}", "@g = global i32 0"].join("\n"),
    );
  });
});
