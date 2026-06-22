#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FileChangeType,
  ProposedFeatures,
  TextDocumentSyncKind,
  createConnection,
  type Diagnostic,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocuments } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CallHierarchyIndex, callHierarchyProviderCapability } from "./lsp/call-hierarchy.ts";
import { documentLinkProviderCapability, getDocumentLinks } from "./lsp/document-links.ts";
import {
  getCompletionItems,
  getDefinition,
  getDiagnostics,
  getDocumentSymbols,
  getFoldingRanges,
  getFormattingEdits,
  getHover,
  getInlayHints,
  getRangeFormattingEdits,
  inlayHintProviderCapability,
  getReferences,
  getRenameEdit,
  getSemanticTokens,
  makeDocumentSnapshot,
  semanticTokenLegend,
  type DocumentSnapshot,
  defaultInlayHintSettings,
  formattingProviderCapability,
  normalizeInlayHintSettings,
  type InlayHintSettings,
} from "./lsp/features.ts";
import {
  defaultDiagnosticSettings,
  mergeVerifierDiagnostics,
  normalizeDiagnosticSettings,
  shouldRunVerifierDiagnostics,
  type DiagnosticSettings,
} from "./lsp/diagnostics.ts";
import {
  defaultVerifierSettings,
  runExternalVerifier,
  type ExternalVerifierSettings,
} from "./lsp/verifier.ts";
import {
  WorkspaceSymbolIndex,
  workspaceSymbolProviderCapability,
} from "./lsp/workspace-symbols.ts";

const DIAGNOSTIC_DEBOUNCE_MS = 150;
const VERIFIER_CONFIG_SECTION = "llvm-analyzer.verifier";
const DIAGNOSTICS_CONFIG_SECTION = "llvm-analyzer.diagnostics";
const INLAY_HINTS_CONFIG_SECTION = "llvm-analyzer.inlayHints";
const SKIPPED_WORKSPACE_DIRS = new Set([".git", "node_modules", "dist", "coverage"]);

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const snapshots = new Map<string, DocumentSnapshot>();
const callHierarchy = new CallHierarchyIndex();
const workspaceSymbols = new WorkspaceSymbolIndex();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const verifierTimers = new Map<string, ReturnType<typeof setTimeout>>();
const verifierControllers = new Map<string, AbortController>();
let supportsConfiguration = false;
let verifierSettingsCache: Promise<ExternalVerifierSettings> | undefined;
let diagnosticSettingsCache: Promise<DiagnosticSettings> | undefined;
let inlayHintSettingsCache: Promise<InlayHintSettings> | undefined;
let initialWorkspaceFolderUris: readonly string[] = [];

connection.onInitialize((params: InitializeParams): InitializeResult => {
  supportsConfiguration = params.capabilities.workspace?.configuration === true;
  initialWorkspaceFolderUris = params.workspaceFolders?.map((folder) => folder.uri) ?? [];
  return {
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
  };
});

connection.onInitialized(() => {
  void indexWorkspaceFolders(initialWorkspaceFolderUris);
});

connection.onDidChangeConfiguration(() => {
  verifierSettingsCache = undefined;
  diagnosticSettingsCache = undefined;
  inlayHintSettingsCache = undefined;
  void connection.languages.inlayHint.refresh().catch(() => {
    // クライアントが refresh をサポートしない場合は次回要求時の再計算に任せる。
  });
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
  if (isLlFileUri(event.document.uri)) void closeWorkspaceDocument(event.document.uri);
});

connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    if (!isLlFileUri(change.uri)) continue;
    if (change.type === FileChangeType.Deleted) {
      workspaceSymbols.delete(change.uri);
      callHierarchy.delete(change.uri);
      snapshots.delete(change.uri);
      continue;
    }
    void indexFile(change.uri);
  }
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

connection.onDocumentLinks((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  return snapshot
    ? getDocumentLinks(snapshot, { workspaceFolderUris: initialWorkspaceFolderUris })
    : [];
});

connection.onWorkspaceSymbol((params) => workspaceSymbols.search(params.query));

connection.languages.callHierarchy.onPrepare((params) =>
  callHierarchy.prepare(params.textDocument.uri, params.position),
);

connection.languages.callHierarchy.onIncomingCalls((params) => callHierarchy.incoming(params.item));

connection.languages.callHierarchy.onOutgoingCalls((params) => callHierarchy.outgoing(params.item));

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

connection.onDocumentFormatting((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  return snapshot ? getFormattingEdits(snapshot) : [];
});

connection.onDocumentRangeFormatting((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  return snapshot ? getRangeFormattingEdits(snapshot, params.range) : [];
});

connection.languages.inlayHint.on((params) => {
  const snapshot = snapshotFor(params.textDocument.uri);
  if (!snapshot) return [];
  return inlayHintSettings().then((settings) => getInlayHints(snapshot, params.range, settings));
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
      if (isLlFileUri(document.uri)) {
        workspaceSymbols.upsertOpenDocument(document.uri, document.getText(), document.version);
        callHierarchy.upsertSnapshot(snapshot);
      }
      void diagnosticSettings()
        .then((settings) => {
          if (!isSnapshotCurrent(snapshot)) return;
          const baseDiagnostics = getDiagnostics(snapshot, settings);
          connection.sendDiagnostics({ uri: document.uri, diagnostics: baseDiagnostics });
          scheduleVerifier(snapshot, baseDiagnostics, settings);
        })
        .catch(() => {
          if (!isSnapshotCurrent(snapshot)) return;
          const baseDiagnostics = getDiagnostics(snapshot);
          connection.sendDiagnostics({ uri: document.uri, diagnostics: baseDiagnostics });
          scheduleVerifier(snapshot, baseDiagnostics, defaultDiagnosticSettings);
        });
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
  settingsForDiagnostics: DiagnosticSettings,
): void {
  if (!shouldRunVerifierDiagnostics(settingsForDiagnostics)) return;
  void verifierSettings()
    .then((settings) => {
      if (!settings.enabled) return;
      if (!isSnapshotCurrent(snapshot)) return;
      const timer = setTimeout(() => {
        verifierTimers.delete(snapshot.uri);
        runVerifier(snapshot, baseDiagnostics, settings, settingsForDiagnostics);
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
  settingsForDiagnostics: DiagnosticSettings,
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
        diagnostics: mergeVerifierDiagnostics(baseDiagnostics, diagnostics, settingsForDiagnostics),
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

function diagnosticSettings(): Promise<DiagnosticSettings> {
  diagnosticSettingsCache ??= loadDiagnosticSettings();
  return diagnosticSettingsCache;
}

function inlayHintSettings(): Promise<InlayHintSettings> {
  inlayHintSettingsCache ??= loadInlayHintSettings();
  return inlayHintSettingsCache;
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

async function loadDiagnosticSettings(): Promise<DiagnosticSettings> {
  if (!supportsConfiguration) return defaultDiagnosticSettings;
  const raw = await connection.workspace.getConfiguration(DIAGNOSTICS_CONFIG_SECTION);
  return normalizeDiagnosticSettings(raw);
}

async function loadInlayHintSettings(): Promise<InlayHintSettings> {
  if (!supportsConfiguration) return defaultInlayHintSettings;
  const raw = await connection.workspace.getConfiguration(INLAY_HINTS_CONFIG_SECTION);
  return normalizeInlayHintSettings(raw);
}

function snapshotFor(uri: string): DocumentSnapshot | undefined {
  const current = documents.get(uri);
  const cached = snapshots.get(uri);
  if (!current) return cached;
  if (cached?.version === current.version) return cached;
  const snapshot = makeDocumentSnapshot(uri, current.getText(), current.version);
  snapshots.set(uri, snapshot);
  if (isLlFileUri(uri)) {
    workspaceSymbols.upsertOpenDocument(uri, current.getText(), current.version);
    callHierarchy.upsertSnapshot(snapshot);
  }
  return snapshot;
}

async function indexWorkspaceFolders(folderUris: readonly string[]): Promise<void> {
  await Promise.all(folderUris.map((folderUri) => indexWorkspaceFolder(folderUri)));
}

async function indexWorkspaceFolder(folderUri: string): Promise<void> {
  let rootPath: string;
  try {
    rootPath = fileURLToPath(folderUri);
  } catch {
    return;
  }
  const filePaths = await collectLlFiles(rootPath);
  await Promise.all(filePaths.map((filePath) => indexFile(pathToFileURL(filePath).toString())));
}

async function collectLlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        return SKIPPED_WORKSPACE_DIRS.has(entry.name) ? [] : collectLlFiles(fullPath);
      }
      return entry.isFile() && entry.name.endsWith(".ll") ? [fullPath] : [];
    }),
  );
  return nested.flat();
}

async function indexFile(uri: string): Promise<void> {
  try {
    const openDocument = documents.get(uri);
    if (openDocument) {
      workspaceSymbols.upsertOpenDocument(uri, openDocument.getText(), openDocument.version);
      callHierarchy.upsert(uri, openDocument.getText(), openDocument.version);
      return;
    }
    const text = await readFile(fileURLToPath(uri), "utf8");
    workspaceSymbols.upsertFile(uri, text);
    callHierarchy.upsert(uri, text);
  } catch {
    workspaceSymbols.delete(uri);
    callHierarchy.delete(uri);
  }
}

async function closeWorkspaceDocument(uri: string): Promise<void> {
  try {
    const text = await readFile(fileURLToPath(uri), "utf8");
    workspaceSymbols.closeOpenDocument(uri, text);
    callHierarchy.upsert(uri, text);
  } catch {
    workspaceSymbols.closeOpenDocument(uri);
    callHierarchy.delete(uri);
  }
}

function isLlFileUri(uri: string): boolean {
  return uri.startsWith("file:") && uri.endsWith(".ll");
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
