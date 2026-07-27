import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { documentLinkProviderCapability, getDocumentLinks } from "./document-links.ts";
import { makeDocumentSnapshot } from "./features.ts";

describe("getDocumentLinks", () => {
  it("resolve なしの DocumentLink provider capability を宣言する", () => {
    expect(documentLinkProviderCapability).toEqual({ resolveProvider: false });
  });

  it("存在する source_filename を workspace 相対の DocumentLink にする", async () => {
    const snapshot = makeDocumentSnapshot(
      "file:///workspace/build/out.ll",
      'source_filename = "src/main.c"\n',
    );
    const links = await getDocumentLinks(snapshot, {
      workspaceFolderUris: ["file:///workspace"],
      fileExists: async (filePath) => filePath === "/workspace/src/main.c",
    });

    expect(links).toEqual([
      {
        range: {
          start: { line: 0, character: 19 },
          end: { line: 0, character: 29 },
        },
        target: "file:///workspace/src/main.c",
        tooltip: "src/main.c",
      },
    ]);
  });

  it("存在しないファイル候補はリンク化しない", async () => {
    const snapshot = makeDocumentSnapshot(
      "file:///workspace/out.ll",
      [
        'source_filename = "missing.c"',
        '!0 = !DIFile(filename: "also-missing.c", directory: "/workspace")',
      ].join("\n"),
    );
    const links = await getDocumentLinks(snapshot, {
      workspaceFolderUris: ["file:///workspace"],
      fileExists: async () => false,
    });

    expect(links).toEqual([]);
  });

  it("workspace外へ出る相対パスと絶対パスはリンク化しない", async () => {
    const snapshot = makeDocumentSnapshot(
      "file:///workspace/build/out.ll",
      [
        'source_filename = "../../secret.c"',
        '!0 = !DIFile(filename: "/tmp/secret.c", directory: "/ignored")',
      ].join("\n"),
    );
    const seen: string[] = [];
    const links = await getDocumentLinks(snapshot, {
      workspaceFolderUris: ["file:///workspace"],
      fileExists: async (filePath) => {
        seen.push(filePath);
        return true;
      },
    });

    expect(links).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("IRファイルのディレクトリから戻るworkspace内の相対パスをリンク化する", async () => {
    const snapshot = makeDocumentSnapshot(
      "file:///workspace/build/out.ll",
      'source_filename = "../src/main.c"\n',
    );
    const seen: string[] = [];
    const links = await getDocumentLinks(snapshot, {
      workspaceFolderUris: ["file:///workspace"],
      fileExists: async (filePath) => {
        seen.push(filePath);
        return filePath === "/workspace/src/main.c";
      },
    });

    expect(seen).toEqual(["/workspace/src/main.c"]);
    expect(links.map((link) => link.target)).toEqual(["file:///workspace/src/main.c"]);
  });

  it("DIFile の絶対パス候補を DocumentLink にする", async () => {
    const snapshot = makeDocumentSnapshot(
      "file:///workspace/out.ll",
      '!0 = !DIFile(filename: "main.c", directory: "/workspace/src")\n',
    );
    const links = await getDocumentLinks(snapshot, {
      workspaceFolderUris: ["file:///workspace"],
      fileExists: async (filePath) => filePath === "/workspace/src/main.c",
    });

    expect(links).toEqual([
      expect.objectContaining({
        target: "file:///workspace/src/main.c",
        tooltip: "/workspace/src/main.c",
      }),
    ]);
  });

  it("既定の存在確認で実在ファイルだけを DocumentLink にする", async () => {
    const dir = await mkdtemp(join(tmpdir(), "llvm-analyzer-document-link-"));
    const sourcePath = join(dir, "main.c");
    await writeFile(sourcePath, "int main(void) { return 0; }\n", "utf8");
    try {
      const snapshot = makeDocumentSnapshot(
        pathToFileURL(join(dir, "out.ll")).toString(),
        `source_filename = "${sourcePath}"\nsource_filename = "${join(dir, "missing.c")}"\n`,
      );
      const links = await getDocumentLinks(snapshot, { workspaceFolderUris: [] });

      expect(links.map((link) => link.target)).toEqual([pathToFileURL(sourcePath).toString()]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("既定の存在確認ではディレクトリを DocumentLink にしない", async () => {
    const dir = await mkdtemp(join(tmpdir(), "llvm-analyzer-document-link-"));
    try {
      const snapshot = makeDocumentSnapshot(
        pathToFileURL(join(dir, "out.ll")).toString(),
        `source_filename = "${dir}"\n`,
      );
      const links = await getDocumentLinks(snapshot, { workspaceFolderUris: [] });

      expect(links).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("非 file URI と不正 workspace URI では解決可能な base だけを使う", async () => {
    const snapshot = makeDocumentSnapshot("untitled:out.ll", 'source_filename = "main.c"\n');
    const seen: string[] = [];
    const links = await getDocumentLinks(snapshot, {
      workspaceFolderUris: ["not a uri", "file:///workspace"],
      fileExists: async (filePath) => {
        seen.push(filePath);
        return filePath === "/workspace/main.c";
      },
    });

    expect(seen).toEqual(["/workspace/main.c"]);
    expect(links.map((link) => link.target)).toEqual(["file:///workspace/main.c"]);
  });

  it("非 file URI かつ workspace folder がない場合はリンク化しない", async () => {
    const snapshot = makeDocumentSnapshot("untitled:out.ll", 'source_filename = "main.c"\n');
    let calls = 0;

    const links = await getDocumentLinks(snapshot, {
      workspaceFolderUris: [],
      fileExists: async () => {
        calls += 1;
        return true;
      },
    });

    expect(links).toEqual([]);
    expect(calls).toBe(0);
  });

  it("同じ解決候補の存在確認を重複して実行しない", async () => {
    const snapshot = makeDocumentSnapshot(
      "file:///workspace/out.ll",
      ['source_filename = "src/main.c"', 'source_filename = "src/main.c"'].join("\n"),
    );
    const seen: string[] = [];
    const links = await getDocumentLinks(snapshot, {
      workspaceFolderUris: ["file:///workspace"],
      fileExists: async (filePath) => {
        seen.push(filePath);
        return filePath === "/workspace/src/main.c";
      },
    });

    expect(links).toHaveLength(2);
    expect(seen).toEqual(["/workspace/src/main.c"]);
  });
});
