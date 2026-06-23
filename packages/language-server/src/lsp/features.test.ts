import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getCompletionItems,
  getCodeActions,
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
  semanticTokenLegend,
  normalizeInlayHintSettings,
  formattingProviderCapability,
  codeActionProviderCapability,
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

/** flat な semantic token data を LSP の5要素単位へ分ける。 */
const chunks = (data: readonly number[], size: number): number[][] => {
  const result: number[][] = [];
  for (let index = 0; index < data.length; index += size) {
    result.push(data.slice(index, index + size));
  }
  return result;
};

/** hover contents が markdown object のときだけ本文を返す。 */
type HoverContents = NonNullable<ReturnType<typeof getHover>>["contents"];

const markdownValue = (contents: HoverContents | undefined): string => {
  if (typeof contents === "object" && !Array.isArray(contents) && "value" in contents) {
    return String(contents.value);
  }
  return "";
};

describe("LSP 機能アダプタ", () => {
  const snapshot = makeDocumentSnapshot("file:///hello.ll", source);

  it("hover はシンボルの種類・型・定義元を英語で返す", () => {
    const hover = getHover(snapshot, { line: 4, character: 4 });

    expect(hover?.contents).toEqual({
      kind: "markdown",
      value: [
        "| Property | Value |",
        "| --- | --- |",
        "| Kind | `local` |",
        "| Type | `i32` |",
        "| Scope | `@main` |",
        "",
        "Definition:",
        "```llvm",
        "%sum = add i32 %x, 1",
        "```",
      ].join("\n"),
    });
  });

  it("hover は関数引数にシグネチャを表示する", () => {
    const hover = getHover(snapshot, { line: 4, character: 18 });

    expect(hover?.contents).toEqual({
      kind: "markdown",
      value: [
        "| Property | Value |",
        "| --- | --- |",
        "| Kind | `parameter` |",
        "| Type | `i32` |",
        "| Scope | `@main` |",
        "",
        "Signature:",
        "```llvm",
        "define i32 @main(i32 %x) {",
        "```",
      ].join("\n"),
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

  it("semanticTokens は type と namespace 系シンボルも分類する", () => {
    const classified = makeDocumentSnapshot(
      "file:///semantic-kinds.ll",
      ["%T = type { i32 }", "!0 = !{}", "attributes #0 = { nounwind }"].join("\n"),
    );
    const tokenTypeIndexes = chunks(getSemanticTokens(classified).data, 5).map((chunk) => chunk[3]);

    expect(tokenTypeIndexes).toEqual(
      expect.arrayContaining([
        semanticTokenLegend.tokenTypes.indexOf("type"),
        semanticTokenLegend.tokenTypes.indexOf("namespace"),
      ]),
    );
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

  it("completion は現在位置の関数スコープだけを候補にする", () => {
    const scoped = makeDocumentSnapshot(
      "file:///completion-scope.ll",
      [
        "@g = global i32 0",
        "define void @f(i32 %x) {",
        "entry:",
        "  %a = add i32 %x, 1",
        "  br label %done",
        "done:",
        "  ret void",
        "}",
        "define void @gfunc(i32 %y) {",
        "other:",
        "  %b = add i32 %y, 1",
        "  ret void",
        "}",
      ].join("\n"),
    );

    const inFunction = getCompletionItems(scoped, { line: 4, character: 11 }).map(
      (item) => item.label,
    );
    expect(inFunction).toEqual(expect.arrayContaining(["@g", "@f", "%x", "%a", "done"]));
    expect(inFunction).not.toEqual(expect.arrayContaining(["%y", "%b", "other"]));

    const atModule = getCompletionItems(scoped, { line: 0, character: 0 }).map(
      (item) => item.label,
    );
    expect(atModule).toEqual(expect.arrayContaining(["@g", "@f", "@gfunc"]));
    expect(atModule).not.toEqual(expect.arrayContaining(["%x", "%a", "done"]));
  });

  it("rename は同一シンボルの全出現だけを書き換える", () => {
    const edit = getRenameEdit(snapshot, { line: 4, character: 4 }, "%total");

    expect(edit?.changes?.[snapshot.uri]).toHaveLength(2);
    expect(edit?.changes?.[snapshot.uri]?.map((change) => change.newText)).toEqual([
      "%total",
      "%total",
    ]);
  });

  it("rename は sigil なしの新名をシンボル種別に合わせて補正する", () => {
    const edit = getRenameEdit(snapshot, { line: 1, character: 1 }, "renamed");

    expect(edit?.changes?.[snapshot.uri]?.map((change) => change.newText)).toEqual(["@renamed"]);
  });

  it("rename はラベル定義とラベル参照の置換文字列を分ける", () => {
    const edit = getRenameEdit(snapshot, { line: 6, character: 1 }, "%done");

    expect(edit?.changes?.[snapshot.uri]).toEqual([
      {
        range: {
          start: { line: 5, character: 11 },
          end: { line: 5, character: 16 },
        },
        newText: "%done",
      },
      {
        range: {
          start: { line: 6, character: 0 },
          end: { line: 6, character: 4 },
        },
        newText: "done",
      },
    ]);
  });

  it("hover は参照位置の range と opcode / type docs を返す", () => {
    expect(getHover(snapshot, { line: 7, character: 11 })?.range).toEqual({
      start: { line: 7, character: 10 },
      end: { line: 7, character: 14 },
    });

    expect(getHover(snapshot, { line: 4, character: 9 })?.contents).toMatchObject({
      kind: "markdown",
      value: expect.stringContaining("Example:"),
    });
    expect(markdownValue(getHover(snapshot, { line: 4, character: 9 })?.contents)).toContain(
      "https://llvm.org/docs/LangRef.html#add-instruction",
    );
    expect(markdownValue(getHover(snapshot, { line: 4, character: 9 })?.contents)).toContain(
      "; sum = lhs + rhs",
    );
    expect(markdownValue(getHover(snapshot, { line: 4, character: 9 })?.contents)).not.toContain(
      "`add`",
    );
    expect(markdownValue(getHover(snapshot, { line: 4, character: 9 })?.contents)).not.toContain(
      "Use:",
    );
    expect(getHover(snapshot, { line: 7, character: 6 })?.contents).toMatchObject({
      kind: "markdown",
      value: expect.stringContaining("32-bit integer type."),
    });
    expect(markdownValue(getHover(snapshot, { line: 7, character: 6 })?.contents)).toContain(
      "https://llvm.org/docs/LangRef.html#integer-type",
    );
  });

  it("hover は declare と icmp の docs を返す", () => {
    const docs = makeDocumentSnapshot(
      "file:///docs-hover.ll",
      [
        "declare i32 @puts(ptr)",
        "define i1 @cmp(i32 %a, i32 %b) {",
        "  %r = icmp eq i32 %a, %b",
        "  ret i1 %r",
        "}",
      ].join("\n"),
    );

    expect(markdownValue(getHover(docs, { line: 0, character: 1 })?.contents)).toContain(
      "external function signature",
    );
    expect(markdownValue(getHover(docs, { line: 2, character: 8 })?.contents)).toContain(
      "; is_equal = lhs == rhs",
    );
  });

  it("hover は属性 docs を返す", () => {
    const docs = makeDocumentSnapshot(
      "file:///attribute-hover.ll",
      [
        "declare void @use(ptr captures(none) %p)",
        "define void @f(ptr noundef %p) nounwind memory(read) {",
        "  ret void",
        "}",
      ].join("\n"),
    );

    expect(getHover(docs, { line: 1, character: 35 })?.range).toEqual({
      start: { line: 1, character: 31 },
      end: { line: 1, character: 39 },
    });
    expect(markdownValue(getHover(docs, { line: 1, character: 35 })?.contents)).toContain(
      "never raises an exception",
    );
    expect(markdownValue(getHover(docs, { line: 1, character: 44 })?.contents)).toContain(
      "https://llvm.org/docs/LangRef.html#function-attributes",
    );
    expect(markdownValue(getHover(docs, { line: 1, character: 25 })?.contents)).toContain(
      "must not be undef or poison",
    );
    expect(markdownValue(getHover(docs, { line: 0, character: 22 })?.contents)).toContain(
      "https://llvm.org/docs/LangRef.html#captures-attr",
    );
  });

  it("hover は網羅追加した属性と属性補助語の docs を返す", () => {
    const docs = makeDocumentSnapshot(
      "file:///complete-attribute-hover.ll",
      [
        'attributes #0 = { "frame-pointer"="all" denormal_fpenv(ieee|ieee) }',
        "declare void @copy(ptr byval(i32) %p) #0",
        "declare void @scan(ptr captures(address, read_provenance) %p) memory(argmem: read)",
      ].join("\n"),
    );

    expect(markdownValue(getHover(docs, { line: 0, character: 18 })?.contents)).toContain(
      "frame pointer policy",
    );
    expect(markdownValue(getHover(docs, { line: 1, character: 24 })?.contents)).toContain(
      "copy of the pointee",
    );
    expect(markdownValue(getHover(docs, { line: 2, character: 33 })?.contents)).toContain(
      "pointer address component",
    );
    expect(markdownValue(getHover(docs, { line: 2, character: 70 })?.contents)).toContain(
      "pointer arguments",
    );
  });

  it("hover はユーザー定義関数名に同名 opcode の説明を混ぜない", () => {
    const userFunction = makeDocumentSnapshot(
      "file:///hover-user-function.ll",
      ["define void @add() {", "entry:", "  ret void", "}"].join("\n"),
    );
    const hover = getHover(userFunction, { line: 0, character: 14 });

    expect(hover?.contents).toMatchObject({
      kind: "markdown",
      value: expect.stringContaining("| Kind | `function` |"),
    });
    expect(markdownValue(hover?.contents)).not.toContain("Adds integer");
  });

  it("references は includeDeclaration=false で定義位置を除外する", () => {
    expect(
      getReferences(snapshot, { line: 7, character: 11 }, { includeDeclaration: false }).map(
        (location) => location.range,
      ),
    ).toEqual([
      {
        start: { line: 7, character: 10 },
        end: { line: 7, character: 14 },
      },
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

  it("codeAction は未定義グローバルを近い名前へ置換する quick fix を返す", () => {
    const broken = makeDocumentSnapshot(
      "file:///quickfix-global.ll",
      [
        "@print = global i32 0",
        "define void @f() {",
        "entry:",
        "  call void @pront()",
        "  ret void",
        "}",
      ].join("\n"),
    );
    const diagnostics = getDiagnostics(broken);
    const actions = getCodeActions(
      broken,
      {
        start: { line: 3, character: 12 },
        end: { line: 3, character: 18 },
      },
      diagnostics,
    );

    expect(actions).toEqual([
      expect.objectContaining({
        title: "`@pront` を `@print` に置換",
        kind: "quickfix",
        edit: {
          changes: {
            [broken.uri]: [
              {
                range: {
                  start: { line: 3, character: 12 },
                  end: { line: 3, character: 18 },
                },
                newText: "@print",
              },
            ],
          },
        },
      }),
    ]);
    expect(codeActionProviderCapability).toEqual({ codeActionKinds: ["quickfix"] });
  });

  it("codeAction はゼロ幅 range が診断先頭にある場合も quick fix を返す", () => {
    const broken = makeDocumentSnapshot(
      "file:///quickfix-global-cursor.ll",
      [
        "@print = global i32 0",
        "define void @f() {",
        "entry:",
        "  call void @pront()",
        "  ret void",
        "}",
      ].join("\n"),
    );
    const diagnostics = getDiagnostics(broken);
    const actions = getCodeActions(
      broken,
      {
        start: { line: 3, character: 12 },
        end: { line: 3, character: 12 },
      },
      diagnostics,
    );

    expect(actions.map((action) => action.title)).toEqual(["`@pront` を `@print` に置換"]);
  });

  it("codeAction は未定義ラベルを近いラベルへ置換する quick fix を返す", () => {
    const broken = makeDocumentSnapshot(
      "file:///quickfix-label.ll",
      ["define void @f() {", "entry:", "  br label %exut", "exit:", "  ret void", "}"].join("\n"),
    );
    const actions = getCodeActions(
      broken,
      {
        start: { line: 2, character: 11 },
        end: { line: 2, character: 16 },
      },
      getDiagnostics(broken),
    );

    expect(actions.map((action) => action.title)).toContain("`%exut` を `%exit` に置換");
  });

  it("codeAction は未定義ローカル値へラベル quick fix を返さない", () => {
    const broken = makeDocumentSnapshot(
      "file:///quickfix-local.ll",
      ["define void @f() {", "entry:", "  %x = add i32 %exut, 1", "exit:", "  ret void", "}"].join(
        "\n",
      ),
    );

    expect(
      getCodeActions(
        broken,
        {
          start: { line: 2, character: 15 },
          end: { line: 2, character: 20 },
        },
        getDiagnostics(broken),
      ),
    ).toEqual([]);
  });

  it("codeAction は別関数ラベルと no-op 置換を候補にしない", () => {
    const broken = makeDocumentSnapshot(
      "file:///quickfix-label-scope.ll",
      [
        "define void @f() {",
        "entry:",
        "  br label %exut",
        "exit:",
        "  ret void",
        "}",
        "define void @g() {",
        "entry:",
        "  br label %exut",
        "exut:",
        "  ret void",
        "}",
      ].join("\n"),
    );
    const actions = getCodeActions(
      broken,
      {
        start: { line: 2, character: 11 },
        end: { line: 2, character: 16 },
      },
      getDiagnostics(broken),
    );

    expect(actions.map((action) => action.title)).toEqual(["`%exut` を `%exit` に置換"]);
  });

  it("codeAction は遠い名前や非重複 range では quick fix を返さない", () => {
    const broken = makeDocumentSnapshot(
      "file:///quickfix-distant.ll",
      [
        "@completely_different = global i32 0",
        "define void @f() {",
        "entry:",
        "  call void @x()",
        "  ret void",
        "}",
      ].join("\n"),
    );

    expect(
      getCodeActions(
        broken,
        {
          start: { line: 3, character: 16 },
          end: { line: 3, character: 16 },
        },
        getDiagnostics(broken),
      ),
    ).toEqual([]);
  });

  it("codeAction は終端命令後の命令削除 quick fix を返す", () => {
    const broken = makeDocumentSnapshot(
      "file:///quickfix-delete.ll",
      ["define void @f() {", "entry:", "  ret void", "  %x = add i32 1, 2", "}"].join("\n"),
    );
    const actions = getCodeActions(
      broken,
      {
        start: { line: 3, character: 2 },
        end: { line: 3, character: 20 },
      },
      getDiagnostics(broken),
    );

    expect(actions).toEqual([
      expect.objectContaining({
        title: "終端命令後の命令を削除",
        edit: {
          changes: {
            [broken.uri]: [
              {
                range: {
                  start: { line: 3, character: 0 },
                  end: { line: 4, character: 0 },
                },
                newText: "",
              },
            ],
          },
        },
      }),
    ]);
  });

  it("codeAction は最終行の終端後命令を末尾まで削除する", () => {
    const broken = makeDocumentSnapshot(
      "file:///quickfix-delete-eof.ll",
      ["define void @f() {", "entry:", "  ret void", "  %x = add i32 1, 2"].join("\n"),
    );
    const actions = getCodeActions(
      broken,
      {
        start: { line: 3, character: 2 },
        end: { line: 3, character: 20 },
      },
      getDiagnostics(broken),
    );

    expect(actions[0]?.edit?.changes?.[broken.uri]?.[0]?.range).toEqual({
      start: { line: 3, character: 0 },
      end: { line: 3, character: 19 },
    });
  });
});
