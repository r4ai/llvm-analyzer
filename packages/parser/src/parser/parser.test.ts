import { describe, expect, it } from "vitest";
import type { IdentifierRef, Module, TopLevelEntry } from "../ast/index.ts";
import { parseModule } from "./parser.ts";

/** トップレベルエントリの種別列を返す。 */
const entryKinds = (source: string): string[] => parseModule(source).ast.entries.map((e) => e.kind);

/** `defines` の名前列を返す（無いものは undefined）。 */
const definedNames = (source: string): Array<string | undefined> =>
  parseModule(source).ast.entries.map((e) => e.defines?.name);

/** エントリ内の参照名を `[kind, name]` の配列で返す。 */
const refsOf = (entry: TopLevelEntry): Array<[string, string]> =>
  entry.references.map((r) => [r.kind, r.name]);

/** ソース上の範囲が生テキストと一致するか（不変条件）。 */
const sliceOf = (source: string, ref: IdentifierRef): string =>
  source.slice(ref.range.start.offset, ref.range.end.offset);

/** 全ノードの range 不変条件（`slice === name`）を再帰的に検証する。 */
const assertSliceInvariant = (source: string, ast: Module): void => {
  for (const entry of ast.entries) {
    const refs: IdentifierRef[] = [...entry.references];
    if (entry.defines) refs.push(entry.defines);
    if (entry.kind === "FunctionDefinition") {
      for (const block of entry.blocks) {
        if (block.label) refs.push(block.label);
        for (const inst of block.instructions) {
          if (inst.result) refs.push(inst.result);
          refs.push(...inst.operands);
        }
        for (const record of block.debugRecords ?? []) {
          refs.push(...record.operands);
        }
      }
    }
    for (const ref of refs) {
      expect(sliceOf(source, ref)).toBe(ref.name);
    }
  }
};

describe("parseModule: 空・空白・コメント", () => {
  it("空入力は entries 空・診断なし", () => {
    const { ast, diagnostics } = parseModule("");
    expect(ast.kind).toBe("Module");
    expect(ast.entries).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it("空白とコメントのみは entries 空", () => {
    expect(entryKinds("  \n; comment\n\t\n")).toEqual([]);
  });
});

describe("parseModule: source_filename / target", () => {
  it("source_filename を解釈しファイル名を取り出す", () => {
    const { ast } = parseModule('source_filename = "hello.c"');
    const entry = ast.entries[0];
    expect(entry?.kind).toBe("SourceFilename");
    if (entry?.kind === "SourceFilename") {
      expect(entry.filename).toBe('"hello.c"');
    }
  });

  it("target datalayout / triple を判別する", () => {
    const src = 'target datalayout = "e-m:e"\ntarget triple = "x86_64-unknown-linux-gnu"';
    const { ast } = parseModule(src);
    expect(ast.entries.map((e) => (e.kind === "TargetDefinition" ? e.target : undefined))).toEqual([
      "datalayout",
      "triple",
    ]);
    expect(ast.entries.map((e) => (e.kind === "TargetDefinition" ? e.value : undefined))).toEqual([
      '"e-m:e"',
      '"x86_64-unknown-linux-gnu"',
    ]);
  });
});

describe("parseModule: 型定義", () => {
  it("%struct.Point = type { i32, i32 } を TypeDefinition にする", () => {
    const { ast } = parseModule("%struct.Point = type { i32, i32 }");
    const entry = ast.entries[0];
    expect(entry?.kind).toBe("TypeDefinition");
    expect(entry?.defines?.name).toBe("%struct.Point");
    expect(entry?.defines?.kind).toBe("LocalRef");
  });
});

describe("parseModule: グローバル変数", () => {
  it("@.str = ... constant ... を GlobalVariable にする", () => {
    const src = '@.str = private unnamed_addr constant [13 x i8] c"hello\\00", align 1';
    const { ast } = parseModule(src);
    const entry = ast.entries[0];
    expect(entry?.kind).toBe("GlobalVariable");
    expect(entry?.defines?.name).toBe("@.str");
    expect(entry?.defines?.kind).toBe("GlobalRef");
  });

  it("初期化子のグローバル参照を references に集める", () => {
    const { ast } = parseModule("@g = global ptr @.str");
    const entry = ast.entries[0];
    expect(entry?.kind).toBe("GlobalVariable");
    if (entry) expect(refsOf(entry)).toEqual([["GlobalRef", "@.str"]]);
  });

  it("複数行のグローバル初期化子を1つの GlobalVariable にする", () => {
    const src = [
      "@llvm.used = appending global [2 x ptr] [",
      "  ptr @foo,",
      "  ptr @bar",
      "]",
    ].join("\n");
    const { ast, diagnostics } = parseModule(src);
    expect(ast.entries).toHaveLength(1);
    expect(ast.entries[0]?.kind).toBe("GlobalVariable");
    expect(diagnostics).toEqual([]);
  });

  it("改行を含む文字列定数の後続トークンまで1つの GlobalVariable にする", () => {
    const src = '@s = private constant [8 x i8] c"foo\\0A\nbar\\00", align 1';
    const { ast, diagnostics } = parseModule(src);

    expect(ast.entries).toHaveLength(1);
    expect(ast.entries[0]?.kind).toBe("GlobalVariable");
    expect(diagnostics).toEqual([]);
  });
});

describe("parseModule: 関数宣言", () => {
  it("declare を FunctionDeclaration にし属性グループ参照を集める", () => {
    const { ast } = parseModule("declare i32 @puts(ptr noundef) #0");
    const entry = ast.entries[0];
    expect(entry?.kind).toBe("FunctionDeclaration");
    expect(entry?.defines?.name).toBe("@puts");
    if (entry) expect(refsOf(entry)).toEqual([["AttributeGroupRef", "#0"]]);
  });
});

describe("parseModule: 関数定義", () => {
  const src = [
    "define dso_local i32 @main() #0 {",
    "entry:",
    "  %retval = alloca i32, align 4",
    "  store i32 0, ptr %retval, align 4",
    "  %call = call i32 @puts(ptr noundef @.str)",
    "  br i1 %cmp, label %then, label %exit",
    "then:",
    "  br label %exit",
    "exit:",
    "  ret i32 0",
    "}",
  ].join("\n");

  it("FunctionDefinition として関数名を defines にする", () => {
    const entry = parseModule(src).ast.entries[0];
    expect(entry?.kind).toBe("FunctionDefinition");
    expect(entry?.defines?.name).toBe("@main");
  });

  it("ラベルごとに基本ブロックへ分割する", () => {
    const entry = parseModule(src).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");
    expect(entry.blocks.map((b) => b.label?.name)).toEqual(["entry", "then", "exit"]);
  });

  it("代入命令の result とオペコードを取り出す", () => {
    const entry = parseModule(src).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");
    const first = entry.blocks[0]?.instructions[0];
    expect(first?.result?.name).toBe("%retval");
    expect(first?.opcode).toBe("alloca");
  });

  it("終端命令は result を持たずオペコードのみ", () => {
    const entry = parseModule(src).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");
    const exit = entry.blocks.at(-1);
    const ret = exit?.instructions.at(-1);
    expect(ret?.result).toBeUndefined();
    expect(ret?.opcode).toBe("ret");
  });

  it("call 命令でグローバル参照を集める", () => {
    const entry = parseModule(src).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");
    const call = entry.blocks[0]?.instructions[2];
    expect(call?.opcode).toBe("call");
    expect(call?.operands.map((o) => o.name)).toContain("@puts");
    expect(call?.operands.map((o) => o.name)).toContain("@.str");
  });

  it("br のラベル参照を LabelRef として集める", () => {
    const entry = parseModule(src).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");
    const br = entry.blocks[0]?.instructions[3];
    const labels = br?.operands.filter((o) => o.kind === "LabelRef").map((o) => o.name);
    expect(labels).toEqual(["%then", "%exit"]);
  });

  it("引数の値参照も references に含む", () => {
    const fn = "define void @f(i32 %x) {\n  ret void\n}";
    const entry = parseModule(fn).ast.entries[0];
    expect(entry?.references.some((r) => r.name === "%x")).toBe(true);
  });

  it("debug record を命令ではない本体要素として分離する", () => {
    const fn = [
      "define void @f(ptr %p) {",
      "entry:",
      "  #dbg_value(ptr %p, !0, !DIExpression(), !1)",
      "  ret void",
      "}",
    ].join("\n");
    const entry = parseModule(fn).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");
    expect(entry.blocks[0]?.instructions.map((instruction) => instruction.opcode)).toEqual(["ret"]);
    expect(entry.blocks[0]?.debugRecords?.map((record) => record.name) ?? []).toEqual([
      "#dbg_value",
    ]);
  });

  it("複数行 debug record を1つの本体要素として扱う", () => {
    const fn = [
      "define void @f(i32 %a, i32 %b) {",
      "entry:",
      "  #dbg_value(!DIArgList(i32 %a, i32 %b),",
      "             !16,",
      "             !DIExpression(DW_OP_LLVM_arg, 0, DW_OP_LLVM_arg, 1, DW_OP_plus),",
      "             !26)",
      "  ret void",
      "}",
    ].join("\n");
    const entry = parseModule(fn).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");
    expect(entry.blocks[0]?.instructions.map((instruction) => instruction.opcode)).toEqual(["ret"]);
    expect(entry.blocks[0]?.debugRecords).toHaveLength(1);
    expect(entry.blocks[0]?.debugRecords?.[0]?.operands.map((operand) => operand.name)).toEqual([
      "%a",
      "%b",
      "!16",
      "!26",
    ]);
  });

  it("ラベル前の debug record は暗黙ブロックに入る", () => {
    const fn = [
      "define void @f(ptr %p) {",
      "  #dbg_value(ptr %p, !0, !DIExpression(), !1)",
      "entry:",
      "  ret void",
      "}",
    ].join("\n");
    const entry = parseModule(fn).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");

    expect(entry.blocks.map((block) => block.label?.name)).toEqual([undefined, "entry"]);
    expect(entry.blocks[0]?.debugRecords?.map((record) => record.name)).toEqual(["#dbg_value"]);
  });

  it("複数行 switch を1つの終端命令として扱う", () => {
    const fn = [
      "define void @f(i32 %x) {",
      "entry:",
      "  switch i32 %x, label %default [",
      "    i32 0, label %zero",
      "    i32 1, label %one",
      "  ]",
      "zero:",
      "  ret void",
      "one:",
      "  ret void",
      "default:",
      "  ret void",
      "}",
    ].join("\n");
    const entry = parseModule(fn).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");
    expect(entry.blocks[0]?.instructions).toHaveLength(1);
    expect(entry.blocks[0]?.instructions[0]?.opcode).toBe("switch");
    expect(
      entry.blocks[0]?.instructions[0]?.operands
        .filter((o) => o.kind === "LabelRef")
        .map((o) => o.name),
    ).toEqual(["%default", "%zero", "%one"]);
  });

  it("関数スコープの use-list order directive を命令にしない", () => {
    const fn = [
      "define void @f(i32 %x) {",
      "entry:",
      "  ret void",
      "  uselistorder i32 %x, { 0 }",
      "}",
    ].join("\n");
    const entry = parseModule(fn).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");
    expect(entry.blocks[0]?.instructions.map((instruction) => instruction.opcode)).toEqual(["ret"]);
    expect(entry.blocks[0]?.directives?.map((directive) => directive.directive)).toEqual([
      "uselistorder",
    ]);
  });

  it("ラベル前の use-list order directive は暗黙ブロックの directive にする", () => {
    const fn = [
      "define void @f(i32 %x) {",
      "  uselistorder i32 %x, { 0 }",
      "entry:",
      "  ret void",
      "}",
    ].join("\n");
    const entry = parseModule(fn).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");

    expect(entry.blocks.map((block) => block.label?.name)).toEqual([undefined, "entry"]);
    expect(entry.blocks[0]?.directives?.map((directive) => directive.directive)).toEqual([
      "uselistorder",
    ]);
    expect(entry.blocks[0]?.instructions).toEqual([]);
  });

  it("数値ラベルで基本ブロックを分割する", () => {
    const fn = "define void @f() {\n0:\n  br label %1\n1:\n  ret void\n}";
    const entry = parseModule(fn).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");
    expect(entry.blocks.map((block) => block.label?.name)).toEqual(["0", "1"]);
  });

  it("引用符付きラベルで基本ブロックを分割する", () => {
    const fn = 'define void @f() {\n"weird label":\n  br label %"weird label"\n}';
    const entry = parseModule(fn).ast.entries[0];
    if (entry?.kind !== "FunctionDefinition") throw new Error("not a function def");
    expect(entry.blocks.map((block) => block.label?.name)).toEqual(['"weird label"']);
    expect(entry.blocks[0]?.instructions[0]?.operands.map((operand) => operand.kind)).toEqual([
      "LabelRef",
    ]);
  });

  it("blockaddress でない壊れた括弧内の % 参照は LabelRef にしない", () => {
    const entry = parseModule("@addr = constant ptr not_blockaddress, %target)").ast.entries[0];

    expect(entry?.references.map((ref) => [ref.kind, ref.name])).toEqual([["LocalRef", "%target"]]);
  });
});

describe("parseModule: 最新 LangRef のトップレベル構文", () => {
  it("module asm / comdat / use-list order を UnknownEntry にしない", () => {
    const src = [
      'module asm "nop"',
      "$foo = comdat any",
      "uselistorder ptr @g, { 1, 0 }",
      "uselistorder_bb @f, %bb, { 0 }",
    ].join("\n");
    const { ast, diagnostics } = parseModule(src);
    expect(ast.entries.map((entry) => entry.kind)).toEqual([
      "ModuleAsm",
      "ComdatDefinition",
      "UseListOrderDirective",
      "UseListOrderDirective",
    ]);
    expect(ast.entries[1]?.defines?.name).toBe("$foo");
    expect(diagnostics).toEqual([]);
  });
});

describe("parseModule: 属性グループ・メタデータ", () => {
  it("attributes #0 = {...} を AttributeGroupDefinition にする", () => {
    const entry = parseModule('attributes #0 = { nounwind "frame-pointer"="all" }').ast.entries[0];
    expect(entry?.kind).toBe("AttributeGroupDefinition");
    expect(entry?.defines?.name).toBe("#0");
  });

  it("名前付きメタデータ !llvm.module.flags = !{!0}", () => {
    const entry = parseModule("!llvm.module.flags = !{!0}").ast.entries[0];
    expect(entry?.kind).toBe("MetadataDefinition");
    expect(entry?.defines?.name).toBe("!llvm.module.flags");
    if (entry) expect(refsOf(entry)).toEqual([["MetadataRef", "!0"]]);
  });

  it("番号付きメタデータ !0 = !{...}", () => {
    const entry = parseModule('!0 = !{i32 1, !"wchar_size", i32 4}').ast.entries[0];
    expect(entry?.kind).toBe("MetadataDefinition");
    expect(entry?.defines?.name).toBe("!0");
    if (entry?.kind === "MetadataDefinition") expect(entry.distinct).toBe(false);
  });

  it("distinct !N = distinct !{...} を判別する", () => {
    const entry = parseModule("!1 = distinct !{!1}").ast.entries[0];
    if (entry?.kind !== "MetadataDefinition") throw new Error("not metadata");
    expect(entry.distinct).toBe(true);
  });
});

describe("parseModule: エラー回復", () => {
  it("解釈不能な行は UnknownEntry にし診断を1件積む", () => {
    const { ast, diagnostics } = parseModule("@@@ garbage line");
    expect(ast.entries[0]?.kind).toBe("UnknownEntry");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
  });

  it("不正行があっても後続の正常行はパースを続ける", () => {
    const src = "??? broken\n@g = global i32 0";
    expect(entryKinds(src)).toEqual(["UnknownEntry", "GlobalVariable"]);
  });

  it("中括弧が閉じない define でも全体を飲み込み診断を出す", () => {
    const { ast, diagnostics } = parseModule("define void @f() {\n  ret void");
    expect(ast.entries[0]?.kind).toBe("FunctionDefinition");
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("本体ブレースの無い define は空ブロック・診断付きで回復する", () => {
    const { ast, diagnostics } = parseModule("define void @f()");
    const entry = ast.entries[0];
    expect(entry?.kind).toBe("FunctionDefinition");
    if (entry?.kind === "FunctionDefinition") expect(entry.blocks).toEqual([]);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("関数名の無い declare でも空名で回復する", () => {
    const entry = parseModule("declare void ()").ast.entries[0];
    expect(entry?.kind).toBe("FunctionDeclaration");
    expect(entry?.defines?.name).toBe("");
  });
});

describe("parseModule: range 不変条件と統合", () => {
  it("hello.ll 相当の全エントリ種別を解釈する", () => {
    const src = [
      'source_filename = "hello.c"',
      'target datalayout = "e-m:e"',
      'target triple = "x86_64-unknown-linux-gnu"',
      '@.str = private unnamed_addr constant [13 x i8] c"hello world\\0A\\00", align 1',
      "%struct.Point = type { i32, i32 }",
      "declare i32 @puts(ptr noundef) #0",
      "define dso_local i32 @main() #0 {",
      "entry:",
      "  %call = call i32 @puts(ptr noundef @.str)",
      "  ret i32 0",
      "}",
      'attributes #0 = { nounwind "frame-pointer"="all" }',
      "!llvm.module.flags = !{!0}",
      '!0 = !{i32 1, !"wchar_size", i32 4}',
    ].join("\n");
    const { ast, diagnostics } = parseModule(src);
    expect(entryKinds(src)).toEqual([
      "SourceFilename",
      "TargetDefinition",
      "TargetDefinition",
      "GlobalVariable",
      "TypeDefinition",
      "FunctionDeclaration",
      "FunctionDefinition",
      "AttributeGroupDefinition",
      "MetadataDefinition",
      "MetadataDefinition",
    ]);
    expect(diagnostics).toEqual([]);
    assertSliceInvariant(src, ast);
  });

  it("identifier 参照の slice が name と一致する", () => {
    const src = "define void @f(ptr %p) {\n  %v = load i32, ptr %p\n  ret void\n}";
    const { ast } = parseModule(src);
    assertSliceInvariant(src, ast);
  });
});

describe("parseModule: defines の網羅", () => {
  it("各エントリ種別の defines 名を列挙する", () => {
    const src = [
      'source_filename = "a"',
      "@g = global i32 0",
      "%t = type {}",
      "declare void @d()",
      "define void @f() {\n ret void\n}",
      "attributes #1 = { nounwind }",
      "!2 = !{}",
    ].join("\n");
    expect(definedNames(src)).toEqual([undefined, "@g", "%t", "@d", "@f", "#1", "!2"]);
  });
});
