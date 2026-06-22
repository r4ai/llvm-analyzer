import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getCompletionItems,
  getDefinition,
  getDiagnostics,
  getDocumentSymbols,
  getFoldingRanges,
  getFormattingEdits,
  getHover,
  getInlayHints,
  getReferences,
  getRangeFormattingEdits,
  getRenameEdit,
  getSemanticTokens,
  makeDocumentSnapshot,
  defaultInlayHintSettings,
  inlayHintProviderCapability,
  normalizeInlayHintSettings,
  formattingProviderCapability,
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

    expect(items.map((item) => item.label)).toEqual(
      expect.arrayContaining(["ptrtoaddr", "captures", "memory", "nofpclass", "b32"]),
    );
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

  it("inlayHint はSSA値の推定型を返す", () => {
    const hints = getInlayHints(snapshot);

    expect(hints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          position: { line: 2, character: 23 },
          label: ": i32",
        }),
        expect.objectContaining({
          position: { line: 4, character: 6 },
          label: ": i32",
        }),
      ]),
    );
  });

  it("inlayHint は要求 range 外の hint を返さない", () => {
    const hints = getInlayHints(snapshot, {
      start: { line: 4, character: 5 },
      end: { line: 4, character: 99 },
    });

    expect(hints).toEqual([
      expect.objectContaining({
        position: { line: 4, character: 6 },
        label: ": i32",
      }),
    ]);
  });

  it("inlayHint は設定で型表示を無効化できる", () => {
    expect(getInlayHints(snapshot, undefined, { types: { enabled: false } })).toEqual([]);
    expect(normalizeInlayHintSettings({ types: { enabled: "yes" } })).toEqual(
      defaultInlayHintSettings,
    );
    expect(inlayHintProviderCapability).toBe(true);
  });

  it("formatting はドキュメント全体のインデントを正規化する", () => {
    const unformatted = makeDocumentSnapshot(
      "file:///format.ll",
      [" define void @f() {", "entry:", "ret void", "}"].join("\n"),
    );
    const edits = getFormattingEdits(unformatted);

    expect(edits).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 3, character: 1 },
        },
        newText: ["define void @f() {", "entry:", "  ret void", "}"].join("\n"),
      },
    ]);
    expect(formattingProviderCapability).toBe(true);
  });

  it("rangeFormatting は指定行範囲だけを置き換える", () => {
    const unformatted = makeDocumentSnapshot(
      "file:///range-format.ll",
      [
        "@g = global i32 0",
        " define void @f() {",
        "entry:",
        "ret void",
        "}",
        "@h = global i32 1",
      ].join("\n"),
    );
    const edits = getRangeFormattingEdits(unformatted, {
      start: { line: 1, character: 0 },
      end: { line: 5, character: 0 },
    });

    expect(edits).toEqual([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 5, character: 0 },
        },
        newText: ["define void @f() {", "entry:", "  ret void", "}", ""].join("\n"),
      },
    ]);
  });

  it("rangeFormatting は end.character が0でない場合に終端行も含める", () => {
    const unformatted = makeDocumentSnapshot(
      "file:///range-format-end-character.ll",
      ["define void @f() {", "entry:", "ret void", "}"].join("\n"),
    );
    const edits = getRangeFormattingEdits(unformatted, {
      start: { line: 2, character: 1 },
      end: { line: 2, character: 4 },
    });

    expect(edits).toEqual([
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 3, character: 0 },
        },
        newText: "  ret void\n",
      },
    ]);
  });

  it("rangeFormatting は最終行までの範囲を末尾位置で置き換える", () => {
    const unformatted = makeDocumentSnapshot(
      "file:///range-format-eof.ll",
      ["define void @f() {", "entry:", "ret void", "}"].join("\n"),
    );
    const edits = getRangeFormattingEdits(unformatted, {
      start: { line: 0, character: 0 },
      end: { line: 3, character: 1 },
    });

    expect(edits[0]?.range.end).toEqual({ line: 3, character: 1 });
    expect(edits[0]?.newText).toBe(["define void @f() {", "entry:", "  ret void", "}"].join("\n"));
  });

  it("rangeFormatting は空 range で変更不要なら edit を返さない", () => {
    const formatted = makeDocumentSnapshot(
      "file:///range-format-empty.ll",
      ["define void @f() {", "entry:", "  ret void", "}"].join("\n"),
    );

    expect(
      getRangeFormattingEdits(formatted, {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 0 },
      }),
    ).toEqual([]);
  });

  it("VSCode contributes.configuration に inlay hint 設定 schema がある", () => {
    const manifest = JSON.parse(readFileSync("packages/vscode-extension/package.json", "utf8")) as {
      contributes?: {
        configuration?: {
          properties?: Record<string, unknown>;
        };
      };
    };

    expect(
      manifest.contributes?.configuration?.properties?.["llvm-analyzer.inlayHints.types.enabled"],
    ).toMatchObject({
      type: "boolean",
      default: defaultInlayHintSettings.types.enabled,
    });
  });
});
