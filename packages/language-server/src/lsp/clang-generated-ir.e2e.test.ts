import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { analyze } from "@llvm-analyzer/analyzer";
import { parseModule } from "@llvm-analyzer/parser";
import { describe, expect, it } from "vitest";
import {
  getDefinition,
  getDiagnostics,
  getDocumentSymbols,
  getFoldingRanges,
  getHover,
  getInlayHints,
  makeDocumentSnapshot,
} from "./features.ts";

const execFileAsync = promisify(execFile);

const clang = process.env["LLVM_ANALYZER_CLANG"] ?? "clang";
const clangxx = process.env["LLVM_ANALYZER_CLANGXX"] ?? "clang++";
const llvmAs = process.env["LLVM_ANALYZER_LLVM_AS"] ?? "llvm-as";
const describeWithClang = [clang, clangxx, llvmAs].every((command) => commandExists(command))
  ? describe
  : describe.skip;

const cSource = [
  "struct Node { int value; struct Node *next; };",
  "",
  "static int helper(struct Node *n, int limit) {",
  "  int total = 0;",
  "  for (int i = 0; n && i < limit; ++i, n = n->next) {",
  "    total += n->value;",
  "  }",
  "  return total;",
  "}",
  "",
  "int entry(struct Node *head, int (*fallback)(int), int limit) {",
  "  int value = helper(head, limit);",
  "  switch (value & 3) {",
  "  case 0: return fallback(value);",
  "  case 1: return value + 7;",
  "  default: return value - 1;",
  "  }",
  "}",
].join("\n");

const cppSource = [
  "int risky(int x) {",
  "  try {",
  "    if (x < 0) throw x;",
  "    return x + 1;",
  "  } catch (long) {",
  "    return -1;",
  "  }",
  "}",
].join("\n");

const structGepSource = [
  "struct S { int a; int b; };",
  "",
  "int field(struct S *s) {",
  "  return s->a + s->b;",
  "}",
].join("\n");

describeWithClang("clang 生成LLVM IR E2E", () => {
  it("Cから生成した最適化IRをLSP機能へ通す", async () => {
    const ir = await compileToLl({
      compiler: clang,
      extension: "c",
      source: cSource,
      args: ["-std=c11", "-O1"],
    });
    await verifyLlvmIr(ir);
    const snapshot = makeDocumentSnapshot("file:///generated/realistic-c.ll", ir);
    const parse = parseModule(ir);
    const model = analyze(parse.ast, { source: ir });

    expect(parse.diagnostics).toEqual([]);
    expect(model.diagnostics()).toEqual([]);
    expect(getDiagnostics(snapshot)).toEqual([]);
    expect(getDocumentSymbols(snapshot).map((symbol) => symbol.name)).toContain("@entry");
    expect(getFoldingRanges(snapshot).length).toBeGreaterThan(0);
    expect(
      model.controlFlowGraphs().find((graph) => graph.functionName === "@entry")?.edges.length,
    ).toBeGreaterThan(3);
    expect(model.directCalls().some((call) => call.callee.name === "@entry")).toBe(false);

    const returnValue = occurrencePosition(ir, "%retval.0", 1);
    expect(getDefinition(snapshot, returnValue)?.range.start).toEqual(
      occurrencePosition(ir, "%retval.0"),
    );
    expect(hoverText(snapshot, "%retval.0")).toContain("| Type | `i32` |");
    expect(getInlayHints(snapshot).some((hint) => hint.label === ": i32")).toBe(true);
  });

  it("Cから生成した名前付き構造体GEPを型参照として解決する", async () => {
    const ir = await compileToLl({
      compiler: clang,
      extension: "c",
      source: structGepSource,
      args: ["-std=c11", "-O0"],
    });
    await verifyLlvmIr(ir);
    const parse = parseModule(ir);
    const model = analyze(parse.ast, { source: ir });
    const snapshot = makeDocumentSnapshot("file:///generated/struct-gep.ll", ir);

    expect(ir).toContain("getelementptr");
    expect(ir).toContain("%struct.S");
    expect(parse.diagnostics).toEqual([]);
    expect(getDefinition(snapshot, occurrencePosition(ir, "%struct.S", 1))?.range.start).toEqual(
      occurrencePosition(ir, "%struct.S"),
    );
    expect(model.diagnostics()).toEqual([]);
  });

  it("C++例外処理IRをlandingpadやinvokeを含めて解析する", async () => {
    const ir = await compileToLl({
      compiler: clangxx,
      extension: "cc",
      source: cppSource,
      args: ["-std=c++17", "-O1"],
    });
    await verifyLlvmIr(ir);
    const snapshot = makeDocumentSnapshot("file:///generated/realistic-cxx.ll", ir);
    const parse = parseModule(ir);
    const model = analyze(parse.ast, { source: ir });
    const risky = parse.ast.entries.find(
      (entry) => entry.kind === "FunctionDefinition" && entry.defines.name === "@_Z5riskyi",
    );

    expect(parse.diagnostics).toEqual([]);
    expect(model.diagnostics()).toEqual([]);
    expect(getDiagnostics(snapshot)).toEqual([]);
    expect(getDocumentSymbols(snapshot).map((symbol) => symbol.name)).toContain("@_Z5riskyi");
    expect(risky).toMatchObject({ kind: "FunctionDefinition" });
    if (risky?.kind !== "FunctionDefinition") throw new Error("関数定義を取得できません");
    expect(
      risky.blocks.flatMap((block) => block.instructions.map((instruction) => instruction.opcode)),
    ).toEqual(expect.arrayContaining(["invoke", "landingpad", "resume", "unreachable"]));
    expect(model.directCalls().map((call) => call.callee.name)).toEqual(
      expect.arrayContaining(["@__cxa_throw", "@__cxa_begin_catch"]),
    );
    expect(hoverText(snapshot, "%retval.0")).toContain("| Type | `i32` |");
  });
});

interface CompileRequest {
  readonly compiler: string;
  readonly extension: string;
  readonly source: string;
  readonly args: readonly string[];
}

const compileToLl = async (request: CompileRequest): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "llvm-analyzer-clang-ir-"));
  const sourcePath = join(dir, `input.${request.extension}`);
  const outputPath = join(dir, "output.ll");
  try {
    await writeFile(sourcePath, request.source, "utf8");
    await execFileAsync(request.compiler, [
      ...request.args,
      "-S",
      "-emit-llvm",
      "-g",
      "-fno-discard-value-names",
      sourcePath,
      "-o",
      outputPath,
    ]);
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const verifyLlvmIr = async (ir: string): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "llvm-analyzer-llvm-as-"));
  const irPath = join(dir, "input.ll");
  try {
    await writeFile(irPath, ir, "utf8");
    await execFileAsync(llvmAs, ["-o", devNull, irPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const occurrencePosition = (
  source: string,
  needle: string,
  occurrence = 0,
): { readonly line: number; readonly character: number } => {
  let offset = -1;
  let from = 0;
  for (let i = 0; i <= occurrence; i += 1) {
    offset = source.indexOf(needle, from);
    if (offset < 0) throw new Error(`${needle} が見つかりません`);
    from = offset + needle.length;
  }
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
};

const hoverText = (snapshot: ReturnType<typeof makeDocumentSnapshot>, needle: string): string => {
  const contents = getHover(snapshot, occurrencePosition(snapshot.text, needle))?.contents;
  if (typeof contents === "object" && !Array.isArray(contents) && "value" in contents) {
    return String(contents.value);
  }
  return "";
};

function commandExists(command: string): boolean {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}
