import { describe, expect, it } from "vitest";
import { defaultVerifierSettings } from "./lsp/verifier.ts";
import { createInitializeResult, normalizeVerifierSettings } from "./server-config.ts";

describe("server config", () => {
  it("initialize capability は主要 LSP 機能を宣言する", () => {
    expect(createInitializeResult().capabilities).toMatchObject({
      textDocumentSync: 2,
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      completionProvider: { resolveProvider: false },
      renameProvider: { prepareProvider: false },
      documentFormattingProvider: true,
      inlayHintProvider: true,
    });
  });

  it("verifier 設定を既定値つきで正規化する", () => {
    expect(
      normalizeVerifierSettings({
        enabled: false,
        command: "llvm-as-20",
        args: ["--verify", "-"],
        debounceMs: 10,
        timeoutMs: 20,
        maxFileBytes: 30,
      }),
    ).toEqual({
      enabled: false,
      command: "llvm-as-20",
      args: ["--verify", "-"],
      debounceMs: 10,
      timeoutMs: 20,
      maxFileBytes: 30,
    });

    expect(
      normalizeVerifierSettings({
        enabled: "yes",
        command: "",
        args: ["ok", 1],
        debounceMs: -1,
        timeoutMs: Number.NaN,
      }),
    ).toEqual(defaultVerifierSettings);
  });
});
