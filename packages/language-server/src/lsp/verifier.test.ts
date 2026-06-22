import { TextDocument } from "vscode-languageserver-textdocument";
import { describe, expect, it } from "vitest";
import {
  defaultVerifierSettings,
  nodeVerifierProcessRunner,
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
  it("enabled=false では runner を呼ばない", async () => {
    let calls = 0;
    const runner: VerifierProcessRunner = async () => {
      calls += 1;
      return { exitCode: 1, stdout: "", stderr: "error" };
    };

    const diagnostics = await runExternalVerifier(documentOf("define void @f() {}\n"), {
      ...defaultVerifierSettings,
      enabled: false,
      runner,
    });

    expect(diagnostics).toEqual([]);
    expect(calls).toBe(0);
  });

  it("exit 0 と aborted=true は診断を出さない", async () => {
    await expect(
      runExternalVerifier(documentOf("define void @f() {}\n"), {
        ...defaultVerifierSettings,
        runner: runnerWith({ exitCode: 0, stdout: "", stderr: "" }),
      }),
    ).resolves.toEqual([]);

    await expect(
      runExternalVerifier(documentOf("define void @f() {}\n"), {
        ...defaultVerifierSettings,
        runner: runnerWith({ exitCode: null, stdout: "", stderr: "", aborted: true }),
      }),
    ).resolves.toEqual([]);
  });

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

  it("非0終了でも stderr が空なら診断を出さない", async () => {
    const diagnostics = await runExternalVerifier(documentOf("define void @f() {}\n"), {
      ...defaultVerifierSettings,
      runner: runnerWith({ exitCode: 1, stdout: "", stderr: "" }),
    });

    expect(diagnostics).toEqual([]);
  });

  it("warning 行は warning 診断に変換する", async () => {
    const diagnostics = await runExternalVerifier(documentOf("define void @f() {\n}\n"), {
      ...defaultVerifierSettings,
      runner: runnerWith({
        exitCode: 1,
        stdout: "",
        stderr: "<stdin>:1:1: warning: suspicious construct\n",
      }),
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: "suspicious construct",
        severity: 2,
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

  it("AbortSignal を runner request へ渡す", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const runner: VerifierProcessRunner = async (request) => {
      received = request.signal;
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await runExternalVerifier(
      documentOf("define void @f() {}\n"),
      { ...defaultVerifierSettings, runner },
      controller.signal,
    );

    expect(received).toBe(controller.signal);
  });

  it("nodeVerifierProcessRunner は stdout / stderr / exit code を収集する", async () => {
    const result = await nodeVerifierProcessRunner({
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stdin.setEncoding('utf8');",
          "let input = '';",
          "process.stdin.on('data', (chunk) => { input += chunk; });",
          "process.stdin.on('end', () => {",
          "  process.stdout.write(input.toUpperCase());",
          "  process.stderr.write('diagnostic');",
          "  process.exit(3);",
          "});",
        ].join(""),
      ],
      input: "ok",
      timeoutMs: 1000,
    });

    expect(result).toEqual({
      exitCode: 3,
      stdout: "OK",
      stderr: "diagnostic",
    });
  });

  it("nodeVerifierProcessRunner は timeout で子プロセスを停止する", async () => {
    const result = await nodeVerifierProcessRunner({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 1000);"],
      input: "",
      timeoutMs: 10,
    });

    expect(result).toEqual(
      expect.objectContaining({
        exitCode: null,
        timedOut: true,
      }),
    );
  });

  it("nodeVerifierProcessRunner は spawn error を結果として返す", async () => {
    const result = await nodeVerifierProcessRunner({
      command: "llvm-analyzer-missing-verifier-command",
      args: [],
      input: "",
      timeoutMs: 1000,
    });

    expect(result).toEqual(
      expect.objectContaining({
        exitCode: null,
        errorCode: "ENOENT",
      }),
    );
  });

  it("nodeVerifierProcessRunner は AbortSignal で実行中プロセスを中止する", async () => {
    const controller = new AbortController();
    const running = nodeVerifierProcessRunner({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 1000);"],
      input: "",
      timeoutMs: 1000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(running).resolves.toEqual(
      expect.objectContaining({
        exitCode: null,
        aborted: true,
      }),
    );
  });
});
