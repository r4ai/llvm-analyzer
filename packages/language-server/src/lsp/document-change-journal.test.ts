import { describe, expect, it } from "vitest";
import type { TextDocumentContentChangeEvent } from "vscode-languageserver";

import { DocumentChangeJournal } from "./document-change-journal.ts";

const change = (text: string): TextDocumentContentChangeEvent => ({ text });

describe("DocumentChangeJournal", () => {
  it("連続するバージョンの変更を通知順にまとめる", () => {
    const journal = new DocumentChangeJournal();
    const first = change("first");
    const second = change("second");

    journal.record("file:///main.ll", 1, 2, [first]);
    journal.record("file:///main.ll", 2, 3, [second]);

    expect(journal.consume("file:///main.ll", 1, 3)).toEqual([first, second]);
    expect(journal.consume("file:///main.ll", 1, 3)).toBe(undefined);
  });

  it("バージョンが連続しない変更では古い列を破棄する", () => {
    const journal = new DocumentChangeJournal();
    const stale = change("stale");
    const latest = change("latest");

    journal.record("file:///main.ll", 1, 2, [stale]);
    journal.record("file:///main.ll", 4, 5, [latest]);

    expect(journal.consume("file:///main.ll", 4, 5)).toEqual([latest]);
  });

  it("要求バージョンと一致しない変更列を返さない", () => {
    const journal = new DocumentChangeJournal();

    journal.record("file:///main.ll", 1, 2, [change("changed")]);

    expect(journal.consume("file:///main.ll", 0, 2)).toBe(undefined);
  });

  it("URI単位で変更列を削除する", () => {
    const journal = new DocumentChangeJournal();

    journal.record("file:///main.ll", 1, 2, [change("changed")]);
    journal.delete("file:///main.ll");

    expect(journal.consume("file:///main.ll", 1, 2)).toBe(undefined);
  });
});
