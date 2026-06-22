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

  it("関数シグネチャ内の名前付き型を parameter と誤登録しない", () => {
    const source = [
      "%Point = type { i32, i32 }",
      "define void @use(%Point %p) {",
      "entry:",
      "  ret void",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.symbols.map((s) => [s.name, s.kind, s.scopeName, s.type])).toEqual([
      ["%Point", "type", "module", undefined],
      ["@use", "function", "module", undefined],
      ["%p", "parameter", "@use", "%Point"],
      ["entry", "label", "@use", "label"],
    ]);
    expect(model.diagnostics()).toEqual([]);
  });

  it("アドレス空間付き ptr 型の関数引数を parameter として登録する", () => {
    const source = [
      "define void @use(ptr addrspace(1) %p) {",
      "entry:",
      "  %addr = ptrtoaddr ptr addrspace(1) %p to i32",
      "  ret void",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.symbols.map((s) => [s.name, s.kind, s.scopeName, s.type])).toEqual([
      ["@use", "function", "module", undefined],
      ["%p", "parameter", "@use", "ptr addrspace(1)"],
      ["entry", "label", "@use", "label"],
      ["%addr", "local", "@use", "i32"],
    ]);
    expect(model.diagnostics()).toEqual([]);
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

  it("関数引数の定義位置を referencesOf で重複させない", () => {
    const source = ["define i32 @main(i32 %x) {", "entry:", "  ret i32 %x", "}"].join("\n");
    const model = modelOf(source);
    const parameter = model.symbolAt(posOf(source, "%x"));

    expect(model.referencesOf(parameter?.id ?? "").map((ref) => ref.range.start.offset)).toEqual([
      posOf(source, "%x").offset,
      posOf(source, "%x", 1).offset,
    ]);
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

  it("phi の incoming label をラベル定義へリンクする", () => {
    const source = [
      "define i32 @f(i1 %cond) {",
      "entry:",
      "  br i1 %cond, label %left, label %right",
      "left:",
      "  br label %merge",
      "right:",
      "  br label %merge",
      "merge:",
      "  %v = phi i32 [ 1, %left ], [ 2, %right ]",
      "  ret i32 %v",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.definitionAt(posOf(source, "%left", 1))?.name).toBe("left");
    expect(model.definitionAt(posOf(source, "%right", 1))?.name).toBe("right");
    expect(model.diagnostics()).toEqual([]);
  });

  it("blockaddress のブロック名を対象関数のラベル定義へリンクする", () => {
    const source = [
      "@addr = constant ptr blockaddress(@f, %target)",
      "define void @f() {",
      "entry:",
      "  br label %target",
      "target:",
      "  ret void",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.definitionAt(posOf(source, "%target"))?.name).toBe("target");
    expect(model.diagnostics()).toEqual([]);
  });

  it("型位置の名前付き型は同名ローカルより型定義を優先して解決する", () => {
    const source = [
      "%T = type { i32 }",
      "define void @f(i32 %T) {",
      "entry:",
      "  %p = alloca %T",
      "  ret void",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.definitionAt(posOf(source, "%T", 2))?.kind).toBe("type");
    expect(model.definitionAt(posOf(source, "%T", 1))?.kind).toBe("parameter");
    expect(model.diagnostics()).toEqual([]);
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

  it("関数宣言の引数名を未定義参照として診断しない", () => {
    const source = "declare void @f(i32 %x)";

    expect(modelOf(source).diagnostics()).toEqual([]);
  });

  it("metadata attachment key を未定義参照として診断しない", () => {
    const source = [
      "define i32 @f(i32 %x) {",
      "entry:",
      "  %y = add i32 %x, 1, !dbg !0",
      "  ret i32 %y",
      "}",
      "!0 = !{}",
    ].join("\n");

    expect(modelOf(source).diagnostics()).toEqual([]);
  });

  it("同一命令内の自己参照を well-formedness 診断にする", () => {
    const source = [
      "define i32 @main() {",
      "entry:",
      "  %x = add i32 1, %x",
      "  ret i32 %x",
      "}",
    ].join("\n");
    const diagnostics = modelOf(source).diagnostics();

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "self-reference-before-definition",
        message: "`%x` は同じ命令内で定義前に参照されています",
      }),
    ]);
  });

  it("終端命令の後に通常命令が続くブロックを診断する", () => {
    const source = [
      "define void @f() {",
      "entry:",
      "  ret void",
      "  call void @side_effect()",
      "}",
      "declare void @side_effect()",
    ].join("\n");
    const diagnostics = modelOf(source).diagnostics();

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "instruction-after-terminator",
        message: "終端命令 `ret` の後に命令があります",
      }),
    ]);
  });

  it("関数スコープの use-list order directive を終端後命令として誤診断しない", () => {
    const source = [
      "define void @f(i32 %x) {",
      "entry:",
      "  ret void",
      "  uselistorder i32 %x, { 0 }",
      "}",
    ].join("\n");

    expect(modelOf(source).diagnostics()).toEqual([]);
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

  it("alloca/getelementptr/icmp の結果型を LangRef に沿って推定する", () => {
    const source = [
      "define i1 @f(i32 %x, ptr %base) {",
      "entry:",
      "  %slot = alloca i32",
      "  %gep = getelementptr i32, ptr %base, i32 1",
      "  %cmp = icmp eq i32 %x, 0",
      "  ret i1 %cmp",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.symbolAt(posOf(source, "%slot"))?.type).toBe("ptr");
    expect(model.symbolAt(posOf(source, "%gep"))?.type).toBe("ptr");
    expect(model.symbolAt(posOf(source, "%cmp"))?.type).toBe("i1");
  });

  it("ptrtoaddr などの cast 系命令は to の後の型を結果型として推定する", () => {
    const source = [
      "define i64 @addr(ptr %p) {",
      "entry:",
      "  %addr = ptrtoaddr ptr %p to i64",
      "  ret i64 %addr",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.symbolAt(posOf(source, "%addr"))?.type).toBe("i64");
  });

  it("型 AST ベースで複合型の引数と命令結果型を推定する", () => {
    const source = [
      "%Point = type { i32, i32 }",
      "define <4 x i32> @wide(%Point addrspace(2)* %p, [8 x ptr] %items) {",
      "entry:",
      "  %loaded = load <4 x i32>, ptr %vec",
      "  ret <4 x i32> %loaded",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.symbolAt(posOf(source, "%p"))?.type).toBe("%Point addrspace(2)*");
    expect(model.symbolAt(posOf(source, "%items"))?.type).toBe("[8 x ptr]");
    expect(model.symbolAt(posOf(source, "%loaded"))?.type).toBe("<4 x i32>");
  });

  it("inline struct と packed struct を含む関数シグネチャから引数型を推定する", () => {
    const source = [
      "define void @f({ i8, i16 } %s, <{ i8, ptr }> %p) {",
      "entry:",
      "  ret void",
      "}",
    ].join("\n");
    const model = modelOf(source);

    expect(model.symbolAt(posOf(source, "%s"))?.type).toBe("{ i8, i16 }");
    expect(model.symbolAt(posOf(source, "%p"))?.type).toBe("<{ i8, ptr }>");
    expect(model.diagnostics()).toEqual([]);
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
