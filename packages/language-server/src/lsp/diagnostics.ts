import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";

export type DiagnosticSource = "parser" | "analyzer" | "verifier";

export type DiagnosticSeveritySetting = "error" | "warning" | "information" | "hint";

export interface DiagnosticSourceSettings {
  readonly enabled: boolean;
  readonly severity: DiagnosticSeveritySetting;
}

export interface DiagnosticSettings {
  readonly parser: DiagnosticSourceSettings;
  readonly analyzer: DiagnosticSourceSettings;
  readonly verifier: DiagnosticSourceSettings;
}

export const defaultDiagnosticSettings: DiagnosticSettings = {
  parser: { enabled: true, severity: "error" },
  analyzer: { enabled: true, severity: "error" },
  verifier: { enabled: true, severity: "error" },
};

/**
 * raw configuration を診断設定へ正規化する。
 *
 * @param raw VSCode configuration などから得た任意値。
 * @returns 欠落・不正値を既定値で補った診断設定。
 */
export const normalizeDiagnosticSettings = (raw: unknown): DiagnosticSettings => {
  if (!isRecord(raw)) return defaultDiagnosticSettings;
  return {
    parser: normalizeSourceSettings(raw.parser, defaultDiagnosticSettings.parser),
    analyzer: normalizeSourceSettings(raw.analyzer, defaultDiagnosticSettings.analyzer),
    verifier: normalizeSourceSettings(raw.verifier, defaultDiagnosticSettings.verifier),
  };
};

/**
 * LSP 診断列に診断ソースごとの有効化・severity 設定を適用する。
 *
 * @param diagnostics 変換済み LSP 診断。
 * @param settings 診断ソースごとの設定。
 * @returns 無効化されたソースを除き、severity を上書きした診断列。
 */
export const applyDiagnosticSettings = (
  diagnostics: readonly Diagnostic[],
  settings: DiagnosticSettings,
): Diagnostic[] =>
  diagnostics
    .filter((diagnostic) => sourceSettings(settings, sourceOf(diagnostic)).enabled)
    .map((diagnostic) =>
      Object.assign({}, diagnostic, {
        severity: toLspSeverity(sourceSettings(settings, sourceOf(diagnostic)).severity),
      }),
    );

/**
 * verifier を起動して診断を publish すべきか判定する。
 *
 * @param settings 診断ソースごとの設定。
 * @returns verifier 診断が有効なら true。
 */
export const shouldRunVerifierDiagnostics = (settings: DiagnosticSettings): boolean =>
  settings.verifier.enabled;

/**
 * 既存の parser/analyzer 診断へ verifier 診断を設定適用後に結合する。
 *
 * @param baseDiagnostics 既に設定適用済みの parser/analyzer 診断。
 * @param verifierDiagnostics external verifier 由来の未適用診断。
 * @param settings 診断ソースごとの設定。
 * @returns publishDiagnostics に渡す診断列。
 */
export const mergeVerifierDiagnostics = (
  baseDiagnostics: readonly Diagnostic[],
  verifierDiagnostics: readonly Diagnostic[],
  settings: DiagnosticSettings,
): Diagnostic[] => [...baseDiagnostics, ...applyDiagnosticSettings(verifierDiagnostics, settings)];

const normalizeSourceSettings = (
  raw: unknown,
  fallback: DiagnosticSourceSettings,
): DiagnosticSourceSettings => {
  if (!isRecord(raw)) return fallback;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    severity: isSeveritySetting(raw.severity) ? raw.severity : fallback.severity,
  };
};

const sourceSettings = (
  settings: DiagnosticSettings,
  source: DiagnosticSource,
): DiagnosticSourceSettings => settings[source];

const sourceOf = (diagnostic: Diagnostic): DiagnosticSource => {
  if (diagnostic.source === "llvm-parser") return "parser";
  if (diagnostic.source === "llvm-verifier") return "verifier";
  return "analyzer";
};

const toLspSeverity = (severity: DiagnosticSeveritySetting): DiagnosticSeverity => {
  switch (severity) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "information":
      return DiagnosticSeverity.Information;
    case "hint":
      return DiagnosticSeverity.Hint;
  }
};

const isSeveritySetting = (value: unknown): value is DiagnosticSeveritySetting =>
  value === "error" || value === "warning" || value === "information" || value === "hint";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
