import { describe, expect, it } from "vitest";
import type { TextDocumentContentChangeEvent } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { getDiagnostics, makeDocumentSnapshot, updateDocumentSnapshot } from "./features.ts";

const source = [
  "declare void @sink(i32)",
  "define i32 @first(i32 %x) {",
  "entry:",
  "  %value = add i32 %x, 1",
  "  call void @sink(i32 %value)",
  "  ret i32 %value",
  "}",
  "define i32 @second(i32 %x) {",
  "entry:",
  "  %value = add i32 %x, 2",
  "  ret i32 %value",
  "}",
].join("\n");

describe("updateDocumentSnapshot", () => {
  it("単一関数内の同じ長さの編集では、その関数だけを再パースする", () => {
    const previous = makeDocumentSnapshot("file:///incremental.ll", source, 1);
    const updatedText = source.replace("%value = add i32 %x, 1", "%value = sub i32 %x, 1");

    const updated = updateDocumentSnapshot(previous, updatedText, 2, [
      replacementChange(source, "%value = add i32 %x, 1", "%value = sub i32 %x, 1"),
    ]);
    const fresh = makeDocumentSnapshot(previous.uri, updatedText, 2);

    expect(updated.parser.strategy).toBe("incremental");
    expect(updated.parser.reparsedBytes).toBeLessThan(source.length);
    expect(updated.parse.ast.entries[0]).toBe(previous.parse.ast.entries[0]);
    expect(updated.parse.ast.entries[1]).not.toBe(previous.parse.ast.entries[1]);
    expect(updated.parse.ast.entries[2]).toBe(previous.parse.ast.entries[2]);
    expect(snapshotContract(updated)).toEqual(snapshotContract(fresh));
  });

  it("長さが変わる局所編集では、後続要素の範囲を新しいソースへ移す", () => {
    const previous = makeDocumentSnapshot("file:///incremental.ll", source, 1);
    const updatedText = source.replace(
      "%value = add i32 %x, 1",
      "%longer = add i32 %x, 100\n  %value = add i32 %longer, 1",
    );

    const updated = updateDocumentSnapshot(previous, updatedText, 2, [
      replacementChange(
        source,
        "%value = add i32 %x, 1",
        "%longer = add i32 %x, 100\n  %value = add i32 %longer, 1",
      ),
    ]);
    const fresh = makeDocumentSnapshot(previous.uri, updatedText, 2);
    const second = updated.parse.ast.entries[2];

    expect(second).not.toBe(previous.parse.ast.entries[2]);
    expect(updatedText.slice(second?.range.start.offset, second?.range.end.offset)).toBe(
      source.slice(
        previous.parse.ast.entries[2]?.range.start.offset,
        previous.parse.ast.entries[2]?.range.end.offset,
      ),
    );
    expect(snapshotContract(updated)).toEqual(snapshotContract(fresh));
  });

  it("トップレベル境界をまたぐ編集は全体パースへ戻す", () => {
    const previous = makeDocumentSnapshot("file:///incremental.ll", source, 1);
    const updatedText = source.replace(
      "}\ndefine i32 @second",
      "}\n@g = global i32 0\ndefine i32 @second",
    );

    const updated = updateDocumentSnapshot(previous, updatedText, 2, [
      replacementChange(
        source,
        "}\ndefine i32 @second",
        "}\n@g = global i32 0\ndefine i32 @second",
      ),
    ]);
    const fresh = makeDocumentSnapshot(previous.uri, updatedText, 2);

    expect(updated.parser.strategy).toBe("full");
    expect(
      updated.parse.ast.entries.every(
        (entry, index) => entry !== previous.parse.ast.entries[index],
      ),
    ).toBe(true);
    expect(snapshotContract(updated)).toEqual(snapshotContract(fresh));
  });

  it("関数境界を壊す編集は全体パースへ戻して構文診断を維持する", () => {
    const previous = makeDocumentSnapshot("file:///incremental.ll", source, 1);
    const updatedText = source.replace(
      "  ret i32 %value\n}\ndefine i32 @second",
      "  ret i32 %value\ndefine i32 @second",
    );

    const updated = updateDocumentSnapshot(previous, updatedText, 2, [
      replacementChange(
        source,
        "  ret i32 %value\n}\ndefine i32 @second",
        "  ret i32 %value\ndefine i32 @second",
      ),
    ]);
    const fresh = makeDocumentSnapshot(previous.uri, updatedText, 2);

    expect(updated.parser.strategy).toBe("full");
    expect(
      updated.parse.ast.entries.every(
        (entry, index) => entry !== previous.parse.ast.entries[index],
      ),
    ).toBe(true);
    expect(snapshotContract(updated)).toEqual(snapshotContract(fresh));
  });

  it("複数のLSP変更を通知順に適用する", () => {
    const previous = makeDocumentSnapshot("file:///incremental.ll", source, 1);
    const firstChange = replacementChange(source, "add i32 %x, 1", "sub i32 %x, 1");
    const afterFirst = source.replace("add i32 %x, 1", "sub i32 %x, 1");
    const secondChange = replacementChange(afterFirst, "add i32 %x, 2", "mul i32 %x, 2");
    const updatedText = afterFirst.replace("add i32 %x, 2", "mul i32 %x, 2");

    const updated = updateDocumentSnapshot(previous, updatedText, 3, [firstChange, secondChange]);

    expect(updated.parser.strategy).toBe("incremental");
    expect(snapshotContract(updated)).toEqual(
      snapshotContract(makeDocumentSnapshot(previous.uri, updatedText, 3)),
    );
  });

  it("全文LSP変更は通知本文を全文解析する", () => {
    const previous = makeDocumentSnapshot("file:///incremental.ll", source, 1);
    const updatedText = "@replacement = global i64 0";

    const updated = updateDocumentSnapshot(previous, updatedText, 2, [{ text: updatedText }]);

    expect(updated.parser.strategy).toBe("full");
    expect(updated.parser.reparsedBytes).toBe(updatedText.length);
    expect(snapshotContract(updated)).toEqual(
      snapshotContract(makeDocumentSnapshot(previous.uri, updatedText, 2)),
    );
  });

  it("変更列がない互換呼び出しでは全文から差分を推定する", () => {
    const previous = makeDocumentSnapshot("file:///incremental.ll", source, 1);
    const updatedText = source.replace("add i32 %x, 1", "sub i32 %x, 1");

    const updated = updateDocumentSnapshot(previous, updatedText, 2);

    expect(updated.parser.strategy).toBe("incremental");
    expect(snapshotContract(updated)).toEqual(
      snapshotContract(makeDocumentSnapshot(previous.uri, updatedText, 2)),
    );
  });

  it("変更列と最終テキストが一致しない場合は最終テキストを正準とする", () => {
    const previous = makeDocumentSnapshot("file:///incremental.ll", source, 1);
    const updatedText = "@canonical = global i32 0";

    const updated = updateDocumentSnapshot(previous, updatedText, 2, []);

    expect(updated.parser.strategy).toBe("full");
    expect(snapshotContract(updated)).toEqual(
      snapshotContract(makeDocumentSnapshot(previous.uri, updatedText, 2)),
    );
  });
});

const replacementChange = (
  sourceText: string,
  before: string,
  replacement: string,
): TextDocumentContentChangeEvent => {
  const start = sourceText.indexOf(before);
  if (start < 0) throw new Error(`置換対象が見つかりません: ${before}`);
  const document = TextDocument.create("file:///change.ll", "llvm", 1, sourceText);
  return {
    range: {
      start: document.positionAt(start),
      end: document.positionAt(start + before.length),
    },
    text: replacement,
  };
};

const snapshotContract = (snapshot: ReturnType<typeof makeDocumentSnapshot>) => ({
  entries: snapshot.parse.ast.entries,
  parseDiagnostics: snapshot.parse.diagnostics,
  symbols: snapshot.model.symbols,
  analyzerDiagnostics: snapshot.model.diagnostics(),
  documentSymbols: snapshot.model.documentSymbols(),
  directCalls: snapshot.model.directCalls(),
  controlFlowGraphs: snapshot.model.controlFlowGraphs(),
  diagnostics: getDiagnostics(snapshot),
});
