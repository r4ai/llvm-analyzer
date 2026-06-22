import { parseModule, type Position } from "@llvm-analyzer/parser";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyzer.ts";
import { formatControlFlowGraphAsMermaid } from "./control-flow.ts";

/** ソースをパースして意味解析する。 */
const modelOf = (source: string) => analyze(parseModule(source).ast, { source });

/** 指定文字列の先頭位置を返す。 */
const posOf = (source: string, needle: string): Position => {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`not found: ${needle}`);
  const prefix = source.slice(0, index);
  const lines = prefix.split("\n");
  return {
    offset: index,
    line: lines.length - 1,
    column: lines.at(-1)?.length ?? 0,
  };
};

describe("Control Flow Graph", () => {
  it("br と ret から関数単位の CFG を構築する", () => {
    const source = [
      "define i32 @main(i1 %cond) {",
      "entry:",
      "  br i1 %cond, label %then, label %exit",
      "then:",
      "  br label %exit",
      "exit:",
      "  ret i32 0",
      "}",
    ].join("\n");
    const graph = modelOf(source).controlFlowGraphs()[0];

    expect(graph?.functionName).toBe("@main");
    expect(graph?.blocks.map((block) => block.name)).toEqual(["entry", "then", "exit"]);
    expect(graph?.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["entry", "then"],
      ["entry", "exit"],
      ["then", "exit"],
    ]);
  });

  it("switch の静的 successor を抽出する", () => {
    const source = [
      "define void @dispatch(i32 %x) {",
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
    const graph = modelOf(source).controlFlowGraphs()[0];

    expect(graph?.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["entry", "default"],
      ["entry", "zero"],
      ["entry", "one"],
    ]);
  });

  it("indirectbr の destination list だけを successor にする", () => {
    const source = [
      "define void @jump(ptr %p) {",
      "entry:",
      "  indirectbr ptr blockaddress(@jump, %trap), [label %ok]",
      "ok:",
      "  ret void",
      "trap:",
      "  ret void",
      "}",
    ].join("\n");
    const graph = modelOf(source).controlFlowGraphs()[0];

    expect(graph?.edges.map((edge) => [edge.from, edge.to])).toEqual([["entry", "ok"]]);
  });

  it("invoke と callbr の successor を抽出し、未知ラベルと重複を除外する", () => {
    const source = [
      "declare void @callee()",
      "define void @f() {",
      "entry:",
      "  invoke void @callee() to label %normal unwind label %unwind",
      "normal:",
      '  callbr void asm sideeffect "", "!i"() to label %exit [label %exit, label %missing]',
      "unwind:",
      "  ret void",
      "exit:",
      "  ret void",
      "}",
    ].join("\n");
    const graph = modelOf(source).controlFlowGraphs()[0];

    expect(graph?.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["entry", "normal"],
      ["entry", "unwind"],
      ["normal", "exit"],
    ]);
  });

  it("暗黙 entry ブロックと現在位置の関数を扱う", () => {
    const source = ["define void @f() {", "  br label %exit", "exit:", "  ret void", "}"].join(
      "\n",
    );
    const model = modelOf(source);

    expect(model.controlFlowGraphs()[0]?.blocks.map((block) => block.name)).toEqual([
      "entry",
      "exit",
    ]);
    expect(model.controlFlowGraphAt(posOf(source, "ret void"))?.functionName).toBe("@f");
  });

  it("Mermaid 形式で表示できる", () => {
    const source = [
      "define void @f() {",
      "entry:",
      "  br label %exit",
      "exit:",
      "  ret void",
      "}",
    ].join("\n");
    const graph = modelOf(source).controlFlowGraphs()[0];

    expect(graph ? formatControlFlowGraphAsMermaid(graph) : "").toBe(
      ["flowchart TD", '  block_0["entry"]', '  block_1["exit"]', "  block_0 --> block_1"].join(
        "\n",
      ),
    );
  });

  it("Mermaid node id の衝突を避け、ラベルをエスケープする", () => {
    const source = [
      "define void @f(i1 %cond) {",
      "entry:",
      "  br i1 %cond, label %a-b, label %a_b",
      "a-b:",
      "  br label %a_b",
      "a_b:",
      "  ret void",
      "}",
    ].join("\n");
    const graph = modelOf(source).controlFlowGraphs()[0];

    expect(graph ? formatControlFlowGraphAsMermaid(graph) : "").toContain('block_1["a-b"]');
    expect(graph ? formatControlFlowGraphAsMermaid(graph) : "").toContain('block_2["a_b"]');
    expect(graph ? formatControlFlowGraphAsMermaid(graph) : "").toContain("block_1 --> block_2");
    expect(
      formatControlFlowGraphAsMermaid({
        functionName: "@quoted",
        range: graph?.range ?? {
          start: { offset: 0, line: 0, column: 0 },
          end: { offset: 0, line: 0, column: 0 },
        },
        blocks: [
          {
            name: 'quote"label',
            range: graph?.range ?? {
              start: { offset: 0, line: 0, column: 0 },
              end: { offset: 0, line: 0, column: 0 },
            },
          },
        ],
        edges: [],
      }),
    ).toContain('block_0["quote\\"label"]');
  });
});
