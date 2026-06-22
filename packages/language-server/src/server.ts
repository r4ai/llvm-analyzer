#!/usr/bin/env node
import {
  ProposedFeatures,
  TextDocumentSyncKind,
  createConnection,
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

const DIAGNOSTIC_DEBOUNCE_MS = 150;

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const snapshots = new Map<string, DocumentSnapshot>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

connection.onInitialize(
  (_params: InitializeParams): InitializeResult => ({
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
  }),
);

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
      connection.sendDiagnostics({ uri: document.uri, diagnostics: getDiagnostics(snapshot) });
      timers.delete(document.uri);
    }, DIAGNOSTIC_DEBOUNCE_MS),
  );
}

function clearPending(uri: string): void {
  const timer = timers.get(uri);
  if (timer) clearTimeout(timer);
  timers.delete(uri);
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
