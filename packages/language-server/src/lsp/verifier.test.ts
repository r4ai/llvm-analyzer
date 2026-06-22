import { TextDocument } from "vscode-languageserver-textdocument";
import { describe, expect, it } from "vitest";
import {
  defaultVerifierSettings,
  runExternalVerifier,
  type VerifierProcessResult,
  type VerifierProcessRunner,
} from "./verifier.ts";

const documentOf = (text: string): TextDocument =>
  TextDocument.create("file:///bad.ll", "llvm", 1, text);

const runnerWith =
  (result: VerifierProcessResult): VerifierProcessRunner =>
  async () =>
    result;

describe("runExternalVerifier", () => {
  it("LLVM stderr の行桁付き error を LSP Diagnostic に変換する", async () => {
    const runner = runnerWith({
      exitCode: 1,
      stdout: "",
      stderr: "<stdin>:2:9: error: expected instruction opcode\n  %x =\n        ^\n",
    });

    const diagnostics = await runExternalVerifier(
      documentOf("define void @f() {\n  %x = bad\n}\n"),
      { ...defaultVerifierSettings, runner },
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        range: {
          start: { line: 1, character: 8 },
          end: { line: 1, character: 9 },
        },
        message: "expected instruction opcode",
        source: "llvm-verifier",
      }),
    ]);
  });

  it("行桁が無い verifier 失敗はファイル先頭の診断にする", async () => {
    const runner = runnerWith({
      exitCode: 1,
      stdout: "",
      stderr: "Instruction does not dominate all uses!\n  %x = add i32 1, 2\n",
    });

    const diagnostics = await runExternalVerifier(documentOf("define void @f() {\n}\n"), {
      ...defaultVerifierSettings,
      runner,
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        message: "Instruction does not dominate all uses!\n  %x = add i32 1, 2",
      }),
    ]);
  });

  it("コマンド未検出では診断を出さない", async () => {
    const runner = runnerWith({
      exitCode: null,
      stdout: "",
      stderr: "",
      errorCode: "ENOENT",
    });

    const diagnostics = await runExternalVerifier(documentOf("define void @f() {\n}\n"), {
      ...defaultVerifierSettings,
      runner,
    });

    expect(diagnostics).toEqual([]);
  });

  it("timeout は warning 診断にする", async () => {
    const runner = runnerWith({
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true,
    });

    const diagnostics = await runExternalVerifier(documentOf("define void @f() {\n}\n"), {
      ...defaultVerifierSettings,
      runner,
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: "LLVM verifier がタイムアウトしました",
        severity: 2,
      }),
    ]);
  });

  it("maxFileBytes を超えるファイルでは runner を呼ばない", async () => {
    let calls = 0;
    const runner: VerifierProcessRunner = async () => {
      calls += 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const diagnostics = await runExternalVerifier(documentOf("define void @f() {}\n"), {
      ...defaultVerifierSettings,
      maxFileBytes: 4,
      runner,
    });

    expect(diagnostics).toEqual([]);
    expect(calls).toBe(0);
  });
});
