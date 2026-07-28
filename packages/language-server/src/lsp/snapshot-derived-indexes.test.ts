import { describe, expect, it } from "vitest";
import { CallHierarchyIndex } from "./call-hierarchy.ts";
import { makeDocumentSnapshot } from "./features.ts";
import { SnapshotDerivedIndexes } from "./snapshot-derived-indexes.ts";
import { WorkspaceSymbolIndex } from "./workspace-symbols.ts";

const source = (name: string, callee?: string): string =>
  `define void @${name}() {
entry:
${callee ? `  call void @${callee}()\n` : ""}  ret void
}`;

const makeIndexes = () => {
  const workspaceSymbols = new WorkspaceSymbolIndex();
  const callHierarchy = new CallHierarchyIndex();
  return {
    workspaceSymbols,
    callHierarchy,
    derived: new SnapshotDerivedIndexes(workspaceSymbols, callHierarchy),
  };
};

describe("SnapshotDerivedIndexes", () => {
  it("保留したsnapshotをDefinition経路では索引化せず、要求されたURIだけ最新化する", () => {
    const { workspaceSymbols, callHierarchy, derived } = makeIndexes();
    const first = makeDocumentSnapshot("file:///first.ll", source("first"));
    const second = makeDocumentSnapshot("file:///second.ll", source("second"));

    derived.defer(first);
    derived.defer(second);

    expect(workspaceSymbols.search("@first")).toEqual([]);
    expect(callHierarchy.prepare(first.uri, { line: 0, character: 13 })).toEqual([]);

    derived.ensure(first.uri);

    expect(workspaceSymbols.search("@first")).toHaveLength(1);
    expect(workspaceSymbols.search("@second")).toEqual([]);
    expect(callHierarchy.prepare(first.uri, { line: 0, character: 13 })).toHaveLength(1);
  });

  it("同じURIの古い保留snapshotを新しいversionで置き換える", () => {
    const { workspaceSymbols, derived } = makeIndexes();
    const uri = "file:///main.ll";

    derived.defer(makeDocumentSnapshot(uri, source("before"), 1));
    derived.defer(makeDocumentSnapshot(uri, source("after"), 2));
    derived.ensure(uri);

    expect(workspaceSymbols.search("@before")).toEqual([]);
    expect(workspaceSymbols.search("@after")).toHaveLength(1);
  });

  it("新しいversionを保留した後に届いた古いsnapshotを無視する", () => {
    const { workspaceSymbols, derived } = makeIndexes();
    const uri = "file:///main.ll";

    derived.defer(makeDocumentSnapshot(uri, source("after"), 2));
    derived.defer(makeDocumentSnapshot(uri, source("before"), 1));
    derived.ensure(uri);

    expect(workspaceSymbols.search("@before")).toEqual([]);
    expect(workspaceSymbols.search("@after")).toHaveLength(1);
  });

  it("全件要求では保留中の各URIを一度ずつ最新化し、再要求で結果を重複させない", () => {
    const { workspaceSymbols, derived } = makeIndexes();

    derived.defer(makeDocumentSnapshot("file:///first.ll", source("first")));
    derived.defer(makeDocumentSnapshot("file:///second.ll", source("second", "first")));
    derived.ensureAll();
    derived.ensureAll();

    expect(workspaceSymbols.search("")).toHaveLength(2);
  });

  it("破棄したURIの保留snapshotは後から索引化しない", () => {
    const { workspaceSymbols, derived } = makeIndexes();
    const snapshot = makeDocumentSnapshot("file:///main.ll", source("main"));

    derived.defer(snapshot);
    derived.discard(snapshot.uri);
    derived.ensureAll();
    derived.ensure(snapshot.uri);

    expect(workspaceSymbols.search("@main")).toEqual([]);
  });
});
