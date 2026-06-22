import { TextDocumentSyncKind, type InitializeResult } from "vscode-languageserver/node";
import { callHierarchyProviderCapability } from "./lsp/call-hierarchy.ts";
import { documentLinkProviderCapability } from "./lsp/document-links.ts";
import {
  codeActionProviderCapability,
  formattingProviderCapability,
  inlayHintProviderCapability,
  semanticTokenLegend,
} from "./lsp/features.ts";
import { defaultVerifierSettings, type ExternalVerifierSettings } from "./lsp/verifier.ts";
import { workspaceSymbolProviderCapability } from "./lsp/workspace-symbols.ts";

/** initialize response に含める capability を作る。 */
export const createInitializeResult = (): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    documentSymbolProvider: true,
    documentLinkProvider: documentLinkProviderCapability,
    workspaceSymbolProvider: workspaceSymbolProviderCapability,
    callHierarchyProvider: callHierarchyProviderCapability,
    completionProvider: { resolveProvider: false },
    codeActionProvider: codeActionProviderCapability,
    renameProvider: { prepareProvider: false },
    foldingRangeProvider: true,
    documentFormattingProvider: formattingProviderCapability,
    documentRangeFormattingProvider: formattingProviderCapability,
    inlayHintProvider: inlayHintProviderCapability,
    semanticTokensProvider: {
      legend: semanticTokenLegend,
      range: false,
      full: true,
    },
  },
});

/** raw configuration を外部 verifier 設定へ正規化する。 */
export const normalizeVerifierSettings = (raw: unknown): ExternalVerifierSettings => {
  if (!isRecord(raw)) return defaultVerifierSettings;
  return {
    enabled: booleanSetting(raw.enabled, defaultVerifierSettings.enabled),
    command: stringSetting(raw.command, defaultVerifierSettings.command),
    args: stringArraySetting(raw.args, defaultVerifierSettings.args),
    debounceMs: numberSetting(raw.debounceMs, defaultVerifierSettings.debounceMs),
    timeoutMs: numberSetting(raw.timeoutMs, defaultVerifierSettings.timeoutMs),
    maxFileBytes: numberSetting(raw.maxFileBytes, defaultVerifierSettings.maxFileBytes),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const booleanSetting = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const stringSetting = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const stringArraySetting = (value: unknown, fallback: readonly string[]): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [...fallback];

const numberSetting = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
