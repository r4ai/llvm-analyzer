import { parseModule } from "@llvm-analyzer/parser";
import { describe, expect, it } from "vitest";
import { collectFileReferenceCandidates } from "./file-references.ts";

describe("collectFileReferenceCandidates", () => {
  it("source_filename のファイル名を候補として抽出する", () => {
    const source = 'source_filename = "src/main.c"\n';
    const candidates = collectFileReferenceCandidates(parseModule(source).ast, source);

    expect(candidates).toEqual([
      {
        path: "src/main.c",
        range: {
          start: { offset: 19, line: 0, column: 19 },
          end: { offset: 29, line: 0, column: 29 },
        },
        source: "source_filename",
      },
    ]);
  });

  it("DIFile の directory と filename を結合して候補として抽出する", () => {
    const source = [
      '!0 = distinct !DIFile(filename: "main.c", directory: "/workspace/src")',
      '!1 = !DIFile(filename: "/tmp/generated.c", directory: "/ignored")',
    ].join("\n");
    const candidates = collectFileReferenceCandidates(parseModule(source).ast, source);

    expect(candidates.map((candidate) => [candidate.path, candidate.source])).toEqual([
      ["/workspace/src/main.c", "debug-metadata"],
      ["/tmp/generated.c", "debug-metadata"],
    ]);
    expect(candidates[0]?.range).toEqual({
      start: { offset: 33, line: 0, column: 33 },
      end: { offset: 39, line: 0, column: 39 },
    });
  });

  it("LLVM IR 文字列の 16 進エスケープを復号する", () => {
    const source = [
      'source_filename = "src\\2Fmain\\20file.c"',
      '!0 = !DIFile(filename: "nested\\5Cmain.c", directory: "debug\\20src")',
    ].join("\n");
    const candidates = collectFileReferenceCandidates(parseModule(source).ast, source);

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "src/main file.c",
      "debug src/nested\\main.c",
    ]);
  });
});
