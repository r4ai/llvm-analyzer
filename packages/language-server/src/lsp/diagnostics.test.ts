import { readFileSync } from "node:fs";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";
import { describe, expect, it } from "vitest";

import {
  applyDiagnosticSettings,
  defaultDiagnosticSettings,
  mergeVerifierDiagnostics,
  normalizeDiagnosticSettings,
  shouldRunVerifierDiagnostics,
} from "./diagnostics.ts";
import { getDiagnostics, makeDocumentSnapshot } from "./features.ts";

describe("diagnostic settings", () => {
  it("parser / analyzer の診断をソースごとに無効化する", () => {
    const snapshot = makeDocumentSnapshot(
      "file:///broken.ll",
      "@@@ garbage line\ndefine i32 @main() {\n  ret i32 %missing\n}\n",
    );

    expect(
      getDiagnostics(snapshot, {
        ...defaultDiagnosticSettings,
        parser: { enabled: false, severity: "error" },
      }).map((diagnostic) => diagnostic.message),
    ).not.toContain("解釈できないトップレベル行です");

    expect(
      getDiagnostics(snapshot, {
        ...defaultDiagnosticSettings,
        analyzer: { enabled: false, severity: "error" },
      }).map((diagnostic) => diagnostic.message),
    ).not.toContain("`%missing` が定義されていません");
  });

  it("parser / analyzer の severity を設定で上書きする", () => {
    const snapshot = makeDocumentSnapshot(
      "file:///broken.ll",
      "@@@ garbage line\ndefine i32 @main() {\n  ret i32 %missing\n}\n",
    );

    const diagnostics = getDiagnostics(snapshot, {
      parser: { enabled: true, severity: "warning" },
      analyzer: { enabled: true, severity: "information" },
      verifier: { enabled: true, severity: "hint" },
    });

    expect(diagnostics.find((diagnostic) => diagnostic.source === "llvm-parser")?.severity).toBe(
      DiagnosticSeverity.Warning,
    );
    expect(diagnostics.find((diagnostic) => diagnostic.source === "llvm-analyzer")?.severity).toBe(
      DiagnosticSeverity.Information,
    );
  });

  it("external verifier 診断も設定で無効化・severity 上書きできる", () => {
    const diagnostics: Diagnostic[] = [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        message: "verifier error",
        severity: DiagnosticSeverity.Error,
        source: "llvm-verifier",
      },
    ];

    expect(
      applyDiagnosticSettings(diagnostics, {
        ...defaultDiagnosticSettings,
        verifier: { enabled: false, severity: "warning" },
      }),
    ).toEqual([]);

    expect(
      applyDiagnosticSettings(diagnostics, {
        ...defaultDiagnosticSettings,
        verifier: { enabled: true, severity: "hint" },
      })[0]?.severity,
    ).toBe(DiagnosticSeverity.Hint);
  });

  it("server が使う verifier 起動判定と診断結合を設定に従わせる", () => {
    const baseDiagnostics: Diagnostic[] = [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        message: "parser error",
        severity: DiagnosticSeverity.Error,
        source: "llvm-parser",
      },
    ];
    const verifierDiagnostics: Diagnostic[] = [
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 1 },
        },
        message: "verifier error",
        severity: DiagnosticSeverity.Error,
        source: "llvm-verifier",
      },
    ];

    const disabled = {
      ...defaultDiagnosticSettings,
      verifier: { enabled: false, severity: "warning" as const },
    };
    const hinted = {
      ...defaultDiagnosticSettings,
      verifier: { enabled: true, severity: "hint" as const },
    };

    expect(shouldRunVerifierDiagnostics(disabled)).toBe(false);
    expect(mergeVerifierDiagnostics(baseDiagnostics, verifierDiagnostics, disabled)).toEqual(
      baseDiagnostics,
    );
    expect(shouldRunVerifierDiagnostics(hinted)).toBe(true);
    expect(mergeVerifierDiagnostics(baseDiagnostics, verifierDiagnostics, hinted)).toEqual([
      baseDiagnostics[0],
      expect.objectContaining({
        message: "verifier error",
        severity: DiagnosticSeverity.Hint,
      }),
    ]);
  });

  it("不正な設定値は既定値へ正規化する", () => {
    expect(
      normalizeDiagnosticSettings({
        parser: { enabled: "no", severity: "loud" },
        analyzer: { enabled: false, severity: "warning" },
        verifier: null,
      }),
    ).toEqual({
      parser: { enabled: true, severity: "error" },
      analyzer: { enabled: false, severity: "warning" },
      verifier: { enabled: true, severity: "error" },
    });
  });

  it("VSCode contributes.configuration の診断設定 schema が既定値と一致する", () => {
    const manifest = JSON.parse(readFileSync("packages/vscode-extension/package.json", "utf8")) as {
      contributes?: {
        configuration?: {
          properties?: Record<string, unknown>;
        };
      };
    };
    const properties = manifest.contributes?.configuration?.properties ?? {};

    for (const source of ["parser", "analyzer", "verifier"] as const) {
      expect(properties[`llvm-analyzer.diagnostics.${source}.enabled`]).toMatchObject({
        type: "boolean",
        default: defaultDiagnosticSettings[source].enabled,
      });
      expect(properties[`llvm-analyzer.diagnostics.${source}.severity`]).toMatchObject({
        type: "string",
        enum: ["error", "warning", "information", "hint"],
        default: defaultDiagnosticSettings[source].severity,
      });
    }
  });
});
