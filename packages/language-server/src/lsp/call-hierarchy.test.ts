import { SymbolKind } from "vscode-languageserver";
import { describe, expect, it } from "vitest";

import { CallHierarchyIndex, callHierarchyProviderCapability } from "./call-hierarchy.ts";

describe("CallHierarchyIndex", () => {
  it("関数位置から call hierarchy item を prepare する", () => {
    const index = new CallHierarchyIndex();
    index.upsert("file:///a.ll", "define void @main() {\n  ret void\n}\n");

    const items = index.prepare("file:///a.ll", { line: 0, character: 14 });
    expect(items).toEqual([
      expect.objectContaining({
        name: "@main",
        kind: SymbolKind.Function,
        uri: "file:///a.ll",
      }),
    ]);
    expect(index.outgoing(items[0]!)).toEqual([]);
    expect(callHierarchyProviderCapability).toBe(true);
  });

  it("複数ファイルをまたぐ直接 callers / callees を返す", () => {
    const index = new CallHierarchyIndex();
    index.upsert("file:///callee.ll", "define void @callee() {\n  ret void\n}\n");
    index.upsert(
      "file:///caller.ll",
      [
        "declare void @callee()",
        "define void @caller() {",
        "entry:",
        "  call void @callee()",
        "  ret void",
        "}",
      ].join("\n"),
    );

    const callee = index.prepare("file:///callee.ll", { line: 0, character: 14 })[0];
    const caller = index.prepare("file:///caller.ll", { line: 1, character: 14 })[0];

    expect(index.incoming(callee!).map((call) => [call.from.name, call.from.uri])).toEqual([
      ["@caller", "file:///caller.ll"],
    ]);
    expect(index.outgoing(caller!).map((call) => [call.to.name, call.to.uri])).toEqual([
      ["@callee", "file:///callee.ll"],
    ]);
  });

  it("同じ caller/callee の複数 call site は fromRanges にまとめる", () => {
    const index = new CallHierarchyIndex();
    index.upsert("file:///callee.ll", "define void @callee() {\n  ret void\n}\n");
    index.upsert(
      "file:///caller.ll",
      [
        "declare void @callee()",
        "define void @caller() {",
        "entry:",
        "  call void @callee()",
        "  call void @callee()",
        "  ret void",
        "}",
      ].join("\n"),
    );

    const callee = index.prepare("file:///callee.ll", { line: 0, character: 14 })[0]!;
    const caller = index.prepare("file:///caller.ll", { line: 1, character: 14 })[0]!;

    expect(index.incoming(callee)).toEqual([
      expect.objectContaining({
        from: expect.objectContaining({ name: "@caller" }),
        fromRanges: [expect.anything(), expect.anything()],
      }),
    ]);
    expect(index.outgoing(caller)).toEqual([
      expect.objectContaining({
        to: expect.objectContaining({ name: "@callee" }),
        fromRanges: [expect.anything(), expect.anything()],
      }),
    ]);
    index.delete("file:///caller.ll");
    expect(index.incoming(callee)).toEqual([]);
  });

  it("更新と削除で古い呼び出し関係を破棄する", () => {
    const index = new CallHierarchyIndex();
    index.upsert("file:///callee.ll", "define void @callee() {\n  ret void\n}\n");
    index.upsert(
      "file:///caller.ll",
      "define void @caller() {\n  call void @callee()\n  ret void\n}\n",
    );

    const callee = index.prepare("file:///callee.ll", { line: 0, character: 14 })[0];
    expect(index.incoming(callee!)).toHaveLength(1);

    index.upsert("file:///caller.ll", "define void @caller() {\n  ret void\n}\n");
    expect(index.incoming(callee!)).toEqual([]);

    index.delete("file:///callee.ll");
    expect(index.prepare("file:///callee.ll", { line: 0, character: 14 })).toEqual([]);
  });

  it("不正な item data と未索引 callee は空結果にする", () => {
    const index = new CallHierarchyIndex();
    index.upsert(
      "file:///caller.ll",
      "define void @caller() {\n  call void @missing()\n  ret void\n}\n",
    );
    const caller = index.prepare("file:///caller.ll", { line: 0, character: 14 })[0]!;

    expect(index.incoming({ ...caller, data: { uri: 1, name: null } })).toEqual([]);
    expect(index.outgoing({ ...caller, data: undefined })).toEqual([]);
    expect(index.outgoing(caller)).toEqual([]);
  });

  it("関数でない位置と未索引 URI の outgoing は空結果にする", () => {
    const index = new CallHierarchyIndex();
    index.upsert("file:///a.ll", "@global = global i32 0\n");

    expect(index.prepare("file:///a.ll", { line: 0, character: 1 })).toEqual([]);
    expect(
      index.outgoing({
        name: "@missing",
        kind: SymbolKind.Function,
        uri: "file:///missing.ll",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        selectionRange: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        data: { uri: "file:///missing.ll", name: "@missing" },
      }),
    ).toEqual([]);
  });
});
