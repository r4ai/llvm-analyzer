import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { devNull } from "node:os";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

export interface VerifierProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly input: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface VerifierProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
  readonly aborted?: boolean;
  readonly errorCode?: string;
}

export type VerifierProcessRunner = (
  request: VerifierProcessRequest,
) => Promise<VerifierProcessResult>;

export interface ExternalVerifierSettings {
  readonly enabled: boolean;
  readonly command: string;
  readonly args: readonly string[];
  readonly debounceMs: number;
  readonly timeoutMs: number;
  readonly maxFileBytes: number;
  readonly runner?: VerifierProcessRunner;
}

export const defaultVerifierSettings: ExternalVerifierSettings = {
  enabled: true,
  command: "llvm-as",
  args: ["-o", "{devNull}", "-"],
  debounceMs: 1000,
  timeoutMs: 5000,
  maxFileBytes: 1_000_000,
};

const LLVM_LOCATION_PATTERN = /.*(?:<stdin>|-):(\d+):(\d+):\s*(error|warning):\s*(.+)$/u;

/**
 * 外部 LLVM verifier を実行し、stderr を LSP 診断へ変換する。
 *
 * @param document 検証対象のドキュメント。
 * @param settings verifier 実行設定。
 * @param signal 新しい編集で古い検証を中止するための AbortSignal。
 * @returns verifier 由来の診断。実行不可・中止・サイズ超過では空配列。
 */
export const runExternalVerifier = async (
  document: TextDocument,
  settings: ExternalVerifierSettings,
  signal?: AbortSignal,
): Promise<Diagnostic[]> => {
  if (!settings.enabled) return [];
  const input = document.getText();
  if (Buffer.byteLength(input, "utf8") > settings.maxFileBytes) return [];

  const runner = settings.runner ?? nodeVerifierProcessRunner;
  const result = await runner({
    command: settings.command,
    args: expandVerifierArgs(settings.args),
    input,
    timeoutMs: settings.timeoutMs,
    ...(signal ? { signal } : {}),
  });

  if (result.aborted) return [];
  if (result.errorCode === "ENOENT") return [];
  if (result.timedOut) {
    return [
      {
        range: startRange(document),
        message: "LLVM verifier がタイムアウトしました",
        severity: DiagnosticSeverity.Warning,
        source: "llvm-verifier",
        code: "timeout",
      },
    ];
  }
  if (result.exitCode === 0) return [];
  return parseVerifierDiagnostics(document, result.stderr);
};

/**
 * Node の子プロセスで verifier コマンドを実行する。
 *
 * @param request 実行コマンド・stdin・timeout。
 * @returns プロセスの終了結果。
 */
export const nodeVerifierProcessRunner: VerifierProcessRunner = (request) =>
  new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const finish = (result: VerifierProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(request.command, request.args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(request.signal ? { signal: request.signal } : {}),
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, request.timeoutMs);

    request.signal?.addEventListener(
      "abort",
      () => {
        child.kill();
        finish({ exitCode: null, stdout, stderr, aborted: true });
      },
      { once: true },
    );

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        exitCode: null,
        stdout,
        stderr,
        errorCode: error.code,
        aborted: error.name === "AbortError",
      });
    });
    child.on("close", (exitCode) => {
      finish({ exitCode, stdout, stderr, ...(timedOut ? { timedOut: true } : {}) });
    });
    child.stdin.on("error", () => {
      // プロセスが先に終了した場合の EPIPE は、close/error 側の結果へ任せる。
    });
    child.stdin.end(request.input);
  });

/** `{devNull}` プレースホルダを実行環境の null device に置換する。 */
const expandVerifierArgs = (args: readonly string[]): string[] =>
  args.map((arg) => (arg === "{devNull}" ? devNull : arg));

/** verifier stderr を LSP 診断へ変換する。 */
const parseVerifierDiagnostics = (document: TextDocument, stderr: string): Diagnostic[] => {
  const diagnostics = stderr
    .split(/\r?\n/u)
    .map((line) => diagnosticFromLine(document, line))
    .filter((diagnostic): diagnostic is Diagnostic => diagnostic !== undefined);
  if (diagnostics.length > 0) return diagnostics;
  const message = stderr.trim();
  if (message.length === 0) return [];
  return [
    {
      range: startRange(document),
      message,
      severity: DiagnosticSeverity.Error,
      source: "llvm-verifier",
      code: "verify",
    },
  ];
};

/** stderr の1行から、位置付き verifier 診断を作る。 */
const diagnosticFromLine = (document: TextDocument, line: string): Diagnostic | undefined => {
  const matched = LLVM_LOCATION_PATTERN.exec(line);
  if (!matched) return undefined;
  const lineNumber = Number(matched[1]);
  const columnNumber = Number(matched[2]);
  const kind = matched[3];
  const message = matched[4] ?? "LLVM verifier diagnostic";
  return {
    range: rangeAt(document, lineNumber, columnNumber),
    message,
    severity: kind === "warning" ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
    source: "llvm-verifier",
    code: "verify",
  };
};

/** 1-based の LLVM 行桁を LSP range へ変換する。 */
const rangeAt = (document: TextDocument, lineNumber: number, columnNumber: number) => {
  const textLines = document.getText().split(/\r?\n/u);
  const line = clamp(lineNumber - 1, 0, Math.max(0, textLines.length - 1));
  const lineLength = textLines[line]?.length ?? 0;
  const character = clamp(columnNumber - 1, 0, lineLength);
  return {
    start: { line, character },
    end: { line, character: Math.min(lineLength, character + 1) },
  };
};

/** ファイル先頭のゼロ幅を避けた range。 */
const startRange = (document: TextDocument) => rangeAt(document, 1, 1);

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
