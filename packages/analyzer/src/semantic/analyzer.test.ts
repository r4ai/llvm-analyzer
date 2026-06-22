import { parseModule, type Position } from "@llvm-analyzer/parser";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyzer.ts";
import { opcodeDocs, typeDocs } from "./docs.ts";
import type { SemanticModel } from "./types.ts";

/** ソースをパースして意味解析する。 */
const modelOf = (source: string): SemanticModel => analyze(parseModule(source).ast, { source });

/** 指定文字列の先頭位置を返す。 */
const posOf = (source: string, needle: string, occurrence = 0): Position => {
  let from = 0;
  for (let i = 0; i <= occurrence; i += 1) {
    const index = source.indexOf(needle, from);
    if (index < 0) throw new Error(`not found: ${needle}`);
    if (i === occurrence) {
      const prefix = source.slice(0, index);
      const lines = prefix.split("\n");
      return {
        offset: index,
        line: lines.length - 1,
        column: lines.at(-1)?.length ?? 0,
      };
    }
    from = index + needle.length;
  }
  throw new Error(`not found: ${needle}`);
};

describe("analyze: シンボル表とスコープ", () => {
  it("トップレベル定義をモジュールスコープへ登録する", () => {
    const source = [
      "@g = global i32 0",
      "%Point = type { i32, i32 }",
      "declare i32 @puts(ptr) #0",
      "attributes #0 = { nounwind }",
      "!0 = !{}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.symbols.map((s) => [s.name, s.kind, s.scopeName])).toEqual([
      ["@g", "global", "module"],
      ["%Point", "type", "module"],
      ["@puts", "function", "module"],
      ["#0", "attributeGroup", "module"],
      ["!0", "metadata", "module"],
    ]);
  });

  it("関数引数・ラベル・命令結果を関数スコープへ登録する", () => {
    const source = [
      "define i32 @main(i32 %argc) {",
      "entry:",
      "  %sum = add i32 %argc, 1",
      "  br label %exit",
      "exit:",
      "  ret i32 %sum",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.symbols.map((s) => [s.name, s.kind, s.scopeName, s.type]).slice(1)).toEqual([
      ["%argc", "parameter", "@main", "i32"],
      ["entry", "label", "@main", "label"],
      ["%sum", "local", "@main", "i32"],
      ["exit", "label", "@main", "label"],
    ]);
  });
});

describe("analyze: 定義参照インデックス", () => {
  it("symbolAt と definitionAt で参照位置から定義へ戻れる", () => {
    const source = [
      "@.str = global i8 0",
      "declare i32 @puts(ptr)",
      "define i32 @main(i32 %argc) {",
      "entry:",
      "  %call = call i32 @puts(ptr @.str)",
      "  ret i32 %argc",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.symbolAt(posOf(source, "@puts", 1))?.name).toBe("@puts");
    expect(model.definitionAt(posOf(source, "@puts", 1))?.name).toBe("@puts");
    expect(model.definitionAt(posOf(source, "%argc", 1))?.kind).toBe("parameter");
    expect(
      model.referencesOf(model.symbolAt(posOf(source, "@puts"))?.id ?? "").map((r) => r.name),
    ).toEqual(["@puts", "@puts"]);
  });

  it("ラベル参照を同じ関数スコープのラベル定義へリンクする", () => {
    const source = [
      "define void @f() {",
      "entry:",
      "  br label %exit",
      "exit:",
      "  ret void",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.definitionAt(posOf(source, "%exit"))?.name).toBe("exit");
  });
});

describe("analyze: 診断", () => {
  it("重複定義を診断する", () => {
    const model = modelOf("@g = global i32 0\n@g = global i32 1");

    expect(model.diagnostics()).toEqual([
      expect.objectContaining({
        code: "duplicate-definition",
        message: "`@g` は既に定義されています",
        severity: "error",
      }),
    ]);
  });

  it("未定義のグローバル・ローカル・ラベル参照を診断する", () => {
    const source = [
      "define i32 @main() {",
      "entry:",
      "  %x = add i32 %missing, 1",
      "  call void @missing()",
      "  br label %absent",
      "}",
    ].join("\n");
    const diagnostics = modelOf(source).diagnostics();

    expect(diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["undefined-reference", "`%missing` が定義されていません"],
      ["undefined-reference", "`@missing` が定義されていません"],
      ["undefined-reference", "`%absent` が定義されていません"],
    ]);
  });
});

describe("analyze: 型解決と documentSymbol", () => {
  it("命令結果の型をオペコード直後の型トークンから推定する", () => {
    const source = [
      "define i32 @main(i32 %argc) {",
      "entry:",
      "  %loaded = load i32, ptr %ptr",
      "  %sum = add i32 %argc, 1",
      "  ret i32 %sum",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.symbolAt(posOf(source, "%loaded"))?.type).toBe("i32");
    expect(model.symbolAt(posOf(source, "%sum"))?.type).toBe("i32");
  });

  it("documentSymbols はトップレベルと関数子要素を返す", () => {
    const source = [
      "@g = global i32 0",
      "define void @f(i32 %x) {",
      "entry:",
      "  %v = add i32 %x, 1",
      "  ret void",
      "}",
    ].join("\n");
    const symbols = modelOf(source).documentSymbols();

    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ["@g", "global"],
      ["@f", "function"],
    ]);
    expect(symbols[1]?.children?.map((s) => [s.name, s.kind])).toEqual([
      ["%x", "parameter"],
      ["entry", "label"],
      ["%v", "local"],
    ]);
  });
});

describe("docs", () => {
  it("オペコード・型のドキュメント辞書を持つ", () => {
    expect(opcodeDocs.get("add")?.label).toBe("add");
    expect(opcodeDocs.get("call")?.markdown).toContain("関数");
    expect(typeDocs.get("ptr")?.markdown).toContain("opaque pointer");
    expect(typeDocs.get("i32")?.label).toBe("i32");
  });
});
