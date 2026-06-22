import { describe, expect, it } from "vitest";

import { formatLlvmType, parseLlvmType } from "./type-parser.ts";

describe("parseLlvmType", () => {
  it.each([
    ["void", { kind: "VoidType" }],
    ["label", { kind: "LabelType" }],
    ["metadata", { kind: "MetadataType" }],
    ["token", { kind: "TokenType" }],
    ["i32", { kind: "IntegerType", bits: 32 }],
    ["b128", { kind: "ByteType", bits: 128 }],
    ["double", { kind: "FloatingPointType", name: "double" }],
    ["%Point", { kind: "NamedType", name: "%Point" }],
    ['%"quoted.type"', { kind: "NamedType", name: '%"quoted.type"' }],
  ])("%s を scalar / named type として読む", (source, expected) => {
    expect(parseLlvmType(source).type).toMatchObject(expected);
    expect(parseLlvmType(source).diagnostics).toEqual([]);
  });

  it.each([
    ["ptr", "ptr"],
    ["ptr addrspace(3)", "ptr addrspace(3)"],
    ["i8*", "i8*"],
    ["%Node addrspace(2)*", "%Node addrspace(2)*"],
  ])("%s を pointer type として読む", (source, printed) => {
    const result = parseLlvmType(source);

    expect(result.diagnostics).toEqual([]);
    expect(formatLlvmType(result.type)).toBe(printed);
  });

  it.each([
    ["<4 x i32>", "<4 x i32>"],
    ["<vscale x 4 x i32>", "<vscale x 4 x i32>"],
    ["[8 x ptr]", "[8 x ptr]"],
    ["{ i32, ptr }", "{ i32, ptr }"],
    ["{}", "{}"],
    ["<{ i8, ptr addrspace(1) }>", "<{ i8, ptr addrspace(1) }>"],
    ["opaque", "opaque"],
  ])("%s を composite type として読む", (source, printed) => {
    const result = parseLlvmType(source);

    expect(result.diagnostics).toEqual([]);
    expect(formatLlvmType(result.type)).toBe(printed);
  });

  it.each([
    ["i32 (ptr, ...)", "i32 (ptr, ...)"],
    ["void ()", "void ()"],
    ["void (%Point*, i64)", "void (%Point*, i64)"],
    ["ptr (i32, [4 x i8])*", "ptr (i32, [4 x i8])*"],
  ])("%s を function type として読む", (source, printed) => {
    const result = parseLlvmType(source);

    expect(result.diagnostics).toEqual([]);
    expect(formatLlvmType(result.type)).toBe(printed);
  });

  it.each([
    ["", "型が空です"],
    ["i32,", "型の末尾に余分なトークンがあります"],
    ["ptr addrspace()", "addrspace の番号が必要です"],
    ["[x i32]", "配列要素数が必要です"],
    ["{ i32, }", "要素型が必要です"],
    ["i32 (ptr, i8", "`)` が必要です"],
  ])("%s は診断を返す", (source, message) => {
    const result = parseLlvmType(source);

    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(message);
  });
});
