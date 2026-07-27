import { describe, expect, it } from "vitest";
import { CONTROL_FLOW_GRAPH_REQUEST, isControlFlowGraphRequestParams } from "./protocol.ts";

describe("CFG request protocol", () => {
  it("request名と入力契約を公開する", () => {
    expect(CONTROL_FLOW_GRAPH_REQUEST).toBe("llvm-analyzer/controlFlowGraph");
    expect(
      isControlFlowGraphRequestParams({
        textDocument: { uri: "file:///main.ll" },
        position: { line: 2, character: 4 },
      }),
    ).toBe(true);
  });

  it.each([
    null,
    {},
    { textDocument: null, position: null },
    { textDocument: { uri: 1 }, position: { line: 0, character: 0 } },
    { textDocument: { uri: "file:///main.ll" }, position: { line: -1, character: 0 } },
    { textDocument: { uri: "file:///main.ll" }, position: { line: 0.5, character: 0 } },
  ])("不正なJSON-RPC入力を拒否する: %j", (value) => {
    expect(isControlFlowGraphRequestParams(value)).toBe(false);
  });
});
