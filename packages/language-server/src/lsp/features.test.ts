import { describe, expect, it } from "vitest";
import {
  getCompletionItems,
  getDefinition,
  getDiagnostics,
  getDocumentSymbols,
  getFoldingRanges,
  getHover,
  getReferences,
  getRenameEdit,
  getSemanticTokens,
  makeDocumentSnapshot,
} from "./features.ts";

const source = [
  'source_filename = "hello.c"',
  "@g = global i32 1",
  "define i32 @main(i32 %x) {",
  "entry:",
  "  %sum = add i32 %x, 1",
  "  br label %exit",
  "exit:",
  "  ret i32 %sum",
  "}",
  "",
].join("\n");

describe("LSP 機能アダプタ", () => {
  const snapshot = makeDocumentSnapshot("file:///hello.ll", source);

  it("hover はシンボルの種類と型を返す", () => {
    const hover = getHover(snapshot, { line: 4, character: 4 });

    expect(hover?.contents).toEqual({
      kind: "markdown",
      value: ["`%sum`", "", "種類: local", "型: i32"].join("\n"),
    });
  });

  it("definition と references は analyzer の範囲を LSP 位置へ変換する", () => {
    expect(getDefinition(snapshot, { line: 7, character: 11 })?.range).toEqual({
      start: { line: 4, character: 2 },
      end: { line: 4, character: 6 },
    });

    expect(getReferences(snapshot, { line: 4, character: 18 })).toHaveLength(2);
  });

  it("documentSymbol は関数配下のローカル定義を含む", () => {
    const symbols = getDocumentSymbols(snapshot);

    expect(symbols.map((symbol) => symbol.name)).toEqual(["@g", "@main"]);
    expect(symbols[1]?.children?.map((symbol) => symbol.name)).toContain("%sum");
  });

  it("semanticTokens は定義と参照を分類して返す", () => {
    const tokens = getSemanticTokens(snapshot);

    expect(tokens.data.length).toBeGreaterThan(0);
    expect(tokens.resultId).toBe(snapshot.version.toString());
  });

  it("diagnostics は parser と analyzer の診断をまとめる", () => {
    const broken = makeDocumentSnapshot(
      "file:///broken.ll",
      "define i32 @main() {\n  ret i32 %missing\n}\n",
    );

    expect(getDiagnostics(broken).map((diagnostic) => diagnostic.message)).toContain(
      "`%missing` が定義されていません",
    );
  });

  it("completion は文脈に合うシンボル候補と基本キーワードを返す", () => {
    const items = getCompletionItems(snapshot, { line: 7, character: 11 });

    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(["%sum", "ret"]));
  });

  it("completion は最新 LangRef の代表的な命令と型を返す", () => {
    const items = getCompletionItems(snapshot, { line: 4, character: 8 });

    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(["ptrtoaddr", "b32"]));
  });

  it("rename は同一シンボルの全出現だけを書き換える", () => {
    const edit = getRenameEdit(snapshot, { line: 4, character: 4 }, "%total");

    expect(edit?.changes?.[snapshot.uri]).toHaveLength(2);
    expect(edit?.changes?.[snapshot.uri]?.map((change) => change.newText)).toEqual([
      "%total",
      "%total",
    ]);
  });

  it("foldingRange は関数ブロックを返す", () => {
    expect(getFoldingRanges(snapshot)).toEqual([
      {
        startLine: 2,
        startCharacter: 0,
        endLine: 8,
        endCharacter: 1,
      },
    ]);
  });
});
