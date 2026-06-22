#!/usr/bin/env node
import {
  ProposedFeatures,
  TextDocumentSyncKind,
  createConnection,
  type Diagnostic,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocuments } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  getCompletionItems,
  getDefinition,
  getDiagnostics,
  getDocumentSymbols,
  getFoldingRanges,
  getHover,
  getReferences,
  getRenameEdit,
  getSemanticTokens,
  makeDocumentSnapshot,
  semanticTokenLegend,
  type DocumentSnapshot,
} from "./lsp/features.ts";
import {
  defaultVerifierSettings,
  runExternalVerifier,
  type ExternalVerifierSettings,
} from "./lsp/verifier.ts";

const DIAGNOSTIC_DEBOUNCE_MS = 150;
const VERIFIER_CONFIG_SECTION = "llvm-analyzer.verifier";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const snapshots = new Map<string, DocumentSnapshot>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const verifierTimers = new Map<string, ReturnType<typeof setTimeout>>();
const verifierControllers = new Map<string, AbortController>();
let supportsConfiguration = false;
let verifierSettingsCache: Promise<ExternalVerifierSettings> | undefined;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  supportsConfiguration = params.capabilities.workspace?.configuration === true;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true,
      completionProvider: { resolveProvider: false },
      renameProvider: { prepareProvider: false },
      foldingRangeProvider: true,
      semanticTokensProvider: {
        legend: semanticTokenLegend,
        range: false,
        full: true,
      },
    },
  };
});

connection.onDidChangeConfiguration(() => {
  verifierSettingsCache = undefined;
  for (const document of documents.all()) {
    scheduleAnalysis(document);
  }
});

documents.onDidOpen((event) => scheduleAnalysis(event.document));
documents.onDidChangeContent((event) => scheduleAnalysis(event.document));
documents.onDidClose((event) => {
  snapshots.delete(event.document.uri);
  clearPending(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.onHover((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  return snapshot ? getHover(snapshot, params.position) : undefined;
});

connection.onDefinition((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  return snapshot ? getDefinition(snapshot, params.position) : undefined;
});

connection.onReferences((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  return snapshot ? getReferences(snapshot, params.position) : [];
});

connection.onDocumentSymbol((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  return snapshot ? getDocumentSymbols(snapshot) : [];
});

connection.onCompletion((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  return snapshot ? getCompletionItems(snapshot, params.position) : [];
});

connection.onRenameRequest((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  return snapshot ? getRenameEdit(snapshot, params.position, params.newName) : undefined;
});

connection.languages.semanticTokens.on((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  return snapshot ? getSemanticTokens(snapshot) : { data: [] };
});

connection.onFoldingRanges((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  return snapshot ? getFoldingRanges(snapshot) : [];
});

documents.listen(connection);
connection.listen();

/**
 * ドキュメント変更を debounce して解析する。
 *
 * @param document 変更された TextDocument。
 */
function scheduleAnalysis(document: TextDocument): void {
  clearPending(document.uri);
  timers.set(
    document.uri,
    setTimeout(() => {
      const snapshot = makeDocumentSnapshot(document.uri, document.getText(), document.version);
      snapshots.set(document.uri, snapshot);
      const baseDiagnostics = getDiagnostics(snapshot);
      connection.sendDiagnostics({ uri: document.uri, diagnostics: baseDiagnostics });
      scheduleVerifier(snapshot, baseDiagnostics);
      timers.delete(document.uri);
    }, DIAGNOSTIC_DEBOUNCE_MS),
  );
}

function clearPending(uri: string): void {
  const timer = timers.get(uri);
  if (timer) clearTimeout(timer);
  timers.delete(uri);
  clearPendingVerifier(uri);
}

function clearPendingVerifier(uri: string): void {
  const timer = verifierTimers.get(uri);
  if (timer) clearTimeout(timer);
  verifierTimers.delete(uri);
  verifierControllers.get(uri)?.abort();
  verifierControllers.delete(uri);
}

function scheduleVerifier(
  snapshot: DocumentSnapshot,
  baseDiagnostics: readonly Diagnostic[],
): void {
  void verifierSettings()
    .then((settings) => {
      if (!settings.enabled) return;
      if (!isSnapshotCurrent(snapshot)) return;
      const timer = setTimeout(() => {
        verifierTimers.delete(snapshot.uri);
        runVerifier(snapshot, baseDiagnostics, settings);
      }, settings.debounceMs);
      verifierTimers.set(snapshot.uri, timer);
    })
    .catch(() => {
      // 設定取得に失敗しても、既存の軽量診断は維持する。
    });
}

function runVerifier(
  snapshot: DocumentSnapshot,
  baseDiagnostics: readonly Diagnostic[],
  settings: ExternalVerifierSettings,
): void {
  if (!isSnapshotCurrent(snapshot)) return;
  const controller = new AbortController();
  verifierControllers.set(snapshot.uri, controller);
  void runExternalVerifier(snapshot.document, settings, controller.signal)
    .then((diagnostics) => {
      if (verifierControllers.get(snapshot.uri) !== controller) return;
      verifierControllers.delete(snapshot.uri);
      if (!isSnapshotCurrent(snapshot)) return;
      connection.sendDiagnostics({
        uri: snapshot.uri,
        diagnostics: [...baseDiagnostics, ...diagnostics],
      });
    })
    .catch(() => {
      if (verifierControllers.get(snapshot.uri) === controller) {
        verifierControllers.delete(snapshot.uri);
      }
    });
}

function isSnapshotCurrent(snapshot: DocumentSnapshot): boolean {
  const current = documents.get(snapshot.uri);
  return current !== undefined && current.version === snapshot.version;
}

function verifierSettings(): Promise<ExternalVerifierSettings> {
  verifierSettingsCache ??= loadVerifierSettings();
  return verifierSettingsCache;
}

async function loadVerifierSettings(): Promise<ExternalVerifierSettings> {
  if (!supportsConfiguration) return defaultVerifierSettings;
  const raw = await connection.workspace.getConfiguration(VERIFIER_CONFIG_SECTION);
  if (!isRecord(raw)) return defaultVerifierSettings;
  return {
    enabled: booleanSetting(raw.enabled, defaultVerifierSettings.enabled),
    command: stringSetting(raw.command, defaultVerifierSettings.command),
    args: stringArraySetting(raw.args, defaultVerifierSettings.args),
    debounceMs: numberSetting(raw.debounceMs, defaultVerifierSettings.debounceMs),
    timeoutMs: numberSetting(raw.timeoutMs, defaultVerifierSettings.timeoutMs),
    maxFileBytes: numberSetting(raw.maxFileBytes, defaultVerifierSettings.maxFileBytes),
  };
}

function snapshotFor(uri: string): DocumentSnapshot | undefined {
  const current = documents.get(uri);
  const cached = snapshots.get(uri);
  if (!current) return cached;
  if (cached?.version === current.version) return cached;
  const snapshot = makeDocumentSnapshot(uri, current.getText(), current.version);
  snapshots.set(uri, snapshot);
  return snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringArraySetting(value: unknown, fallback: readonly string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [...fallback];
}

function numberSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
