import { describe, expect, it } from "vitest";
import { parseModule } from "../parser/index.ts";
import { formatLlvmIr } from "./formatter.ts";

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
});
