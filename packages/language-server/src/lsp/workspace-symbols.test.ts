import { readFileSync } from "node:fs";
import { SymbolKind } from "vscode-languageserver";
import { describe, expect, it } from "vitest";

import { WorkspaceSymbolIndex, workspaceSymbolProviderCapability } from "./workspace-symbols.ts";
import { makeDocumentSnapshot } from "./features.ts";

describe("WorkspaceSymbolIndex", () => {
  it("workspace/symbol provider capability を有効にする", () => {
    expect(workspaceSymbolProviderCapability).toBe(true);
  });

  it("VSCode client は .ll file watcher を language-server へ同期する", () => {
    const extensionSource = readFileSync("packages/vscode-extension/src/extension.ts", "utf8");

    expect(extensionSource).toContain('workspace.createFileSystemWatcher("**/*.ll")');
  });

  it("複数 .ll ファイルのトップレベル定義を workspace symbol として返す", () => {
    const index = new WorkspaceSymbolIndex();
    index.upsert("file:///a.ll", ["%T = type { i32 }", "@g = global i32 0"].join("\n"));
    index.upsert(
      "file:///b.ll",
      [
        "$group = comdat any",
        "define void @main() {",
        "entry:",
        "  ret void",
        "}",
        "!named = !{!0}",
        "attributes #0 = { nounwind }",
      ].join("\n"),
    );

    expect(
      index.search("").map((symbol) => [symbol.name, symbol.kind, symbol.location.uri]),
    ).toEqual([
      ["%T", SymbolKind.Struct, "file:///a.ll"],
      ["@g", SymbolKind.Variable, "file:///a.ll"],
      ["$group", SymbolKind.Namespace, "file:///b.ll"],
      ["@main", SymbolKind.Function, "file:///b.ll"],
      ["!named", SymbolKind.Object, "file:///b.ll"],
      ["#0", SymbolKind.Namespace, "file:///b.ll"],
    ]);
  });

  it("query に一致する symbol だけを大文字小文字を無視して返す", () => {
    const index = new WorkspaceSymbolIndex();
    index.upsert("file:///a.ll", "@global_counter = global i32 0\n");
    index.upsert(
      "file:///b.ll",
      ["@global_value = global i32 0", "define void @main() {", "  ret void", "}"].join("\n"),
    );

    expect(index.search("COUNTER").map((symbol) => symbol.name)).toEqual(["@global_counter"]);
    index.delete("file:///a.ll");
    expect(index.search("global").map((symbol) => symbol.name)).toEqual(["@global_value"]);
  });

  it("ファイル変更時は古い索引を置き換え、削除時は破棄する", () => {
    const index = new WorkspaceSymbolIndex();
    index.upsert("file:///a.ll", "@old = global i32 0\n");
    index.upsert("file:///a.ll", "@new = global i32 0\n");

    expect(index.search("").map((symbol) => symbol.name)).toEqual(["@new"]);

    index.delete("file:///a.ll");

    expect(index.search("new")).toEqual([]);
  });

  it("open document の内容を disk snapshot より優先し、close 時に disk snapshot へ戻せる", () => {
    const index = new WorkspaceSymbolIndex();
    index.upsert("file:///a.ll", "@disk = global i32 0\n");
    index.upsertOpenDocument("file:///a.ll", "@draft = global i32 0\n", 2);

    index.upsertFile("file:///a.ll", "@disk = global i32 0\n");

    expect(index.search("").map((symbol) => symbol.name)).toEqual(["@draft"]);

    index.closeOpenDocument("file:///a.ll", "@disk = global i32 0\n");

    expect(index.search("").map((symbol) => symbol.name)).toEqual(["@disk"]);
  });

  it("解析済みopen documentを受け取り、再解析せずに索引へ登録する", () => {
    const index = new WorkspaceSymbolIndex();
    const snapshot = makeDocumentSnapshot("file:///a.ll", "@draft = global i32 0\n", 2);

    index.upsertOpenSnapshot(snapshot);
    index.upsertFile(snapshot.uri, "@disk = global i32 0\n");

    expect(index.search("").map((symbol) => symbol.name)).toEqual(["@draft"]);
  });

  it("open document close 時に disk snapshot が読めなければ索引を破棄する", () => {
    const index = new WorkspaceSymbolIndex();
    index.upsertOpenDocument("file:///missing.ll", "@draft = global i32 0\n", 2);

    index.closeOpenDocument("file:///missing.ll");

    expect(index.search("draft")).toEqual([]);
  });

  it("関数内の parameter / local / label は workspace symbol に含めない", () => {
    const index = new WorkspaceSymbolIndex();
    index.upsert(
      "file:///a.ll",
      [
        "define i32 @main(i32 %x) {",
        "entry:",
        "  %sum = add i32 %x, 1",
        "  ret i32 %sum",
        "}",
      ].join("\n"),
    );

    expect(index.search("").map((symbol) => symbol.name)).toEqual(["@main"]);
  });
});
