import {
  SymbolKind,
  type CallHierarchyIncomingCall,
  type CallHierarchyItem,
  type CallHierarchyOutgoingCall,
  type Position,
  type Range,
} from "vscode-languageserver";

import type { DirectCall, SemanticSymbol } from "@llvm-analyzer/analyzer";
import { makeDocumentSnapshot, type DocumentSnapshot } from "./features.ts";

export const callHierarchyProviderCapability = true;

interface CallHierarchyData {
  readonly uri: string;
  readonly name: string;
}

/** 解析済み `.ll` ファイル群から直接呼び出し階層を返す索引。 */
export class CallHierarchyIndex {
  private readonly documents = new Map<string, IndexedCallDocument>();
  private readonly callsByCallee = new Map<string, Set<IndexedDirectCall>>();

  upsert(uri: string, text: string, version = 1): void {
    this.upsertSnapshot(makeDocumentSnapshot(uri, text, version));
  }

  upsertSnapshot(snapshot: DocumentSnapshot): void {
    this.removeDocument(snapshot.uri, false);
    const document = indexCallDocument(snapshot);
    this.documents.set(snapshot.uri, document);
    for (const call of document.calls) {
      const calls = this.callsByCallee.get(call.call.callee.name);
      if (calls) calls.add(call);
      else this.callsByCallee.set(call.call.callee.name, new Set([call]));
    }
  }

  delete(uri: string): void {
    this.removeDocument(uri);
  }

  prepare(uri: string, position: Position): CallHierarchyItem[] {
    const document = this.documents.get(uri);
    if (!document) return [];
    const symbol = document.snapshot.model.symbolAt({
      offset: document.snapshot.document.offsetAt(position),
      line: position.line,
      column: position.character,
    });
    if (!symbol || symbol.kind !== "function") return [];
    return [toCallHierarchyItem(uri, symbol)];
  }

  incoming(item: CallHierarchyItem): CallHierarchyIncomingCall[] {
    const target = dataOf(item);
    if (!target) return [];
    const calls = new Map<string, CallHierarchyIncomingCall>();
    for (const indexedCall of this.callsByCallee.get(target.name) ?? []) {
      const document = this.documents.get(indexedCall.uri)!;
      const caller = document.functions.get(indexedCall.call.caller.name)!;
      const key = `${indexedCall.uri}\0${caller.name}`;
      const existing = calls.get(key);
      if (existing) existing.fromRanges.push(toLspRange(indexedCall.call.range));
      else {
        calls.set(key, {
          from: toCallHierarchyItem(indexedCall.uri, caller),
          fromRanges: [toLspRange(indexedCall.call.range)],
        });
      }
    }
    return [...calls.values()];
  }

  outgoing(item: CallHierarchyItem): CallHierarchyOutgoingCall[] {
    const source = dataOf(item);
    if (!source) return [];
    const document = this.documents.get(source.uri);
    if (!document) return [];
    const calls = new Map<string, CallHierarchyOutgoingCall>();
    for (const call of document.callsByCaller.get(source.name) ?? []) {
      const callee = this.findFunction(call.callee.name);
      if (!callee) continue;
      const key = `${callee.uri}\0${callee.symbol.name}`;
      const existing = calls.get(key);
      if (existing) existing.fromRanges.push(toLspRange(call.range));
      else {
        calls.set(key, {
          to: toCallHierarchyItem(callee.uri, callee.symbol),
          fromRanges: [toLspRange(call.range)],
        });
      }
    }
    return [...calls.values()];
  }

  private findFunction(
    name: string,
  ): { readonly uri: string; readonly symbol: SemanticSymbol } | undefined {
    for (const [uri, document] of this.documents) {
      const symbol = document.functions.get(name);
      if (symbol) return { uri, symbol };
    }
    return undefined;
  }

  private removeDocument(uri: string, deleteEntry = true): void {
    const document = this.documents.get(uri);
    if (!document) return;
    for (const call of document.calls) {
      const calls = this.callsByCallee.get(call.call.callee.name)!;
      calls.delete(call);
      if (calls.size === 0) this.callsByCallee.delete(call.call.callee.name);
    }
    if (deleteEntry) this.documents.delete(uri);
  }
}

interface IndexedCallDocument {
  readonly snapshot: DocumentSnapshot;
  readonly functions: ReadonlyMap<string, SemanticSymbol>;
  readonly calls: readonly IndexedDirectCall[];
  readonly callsByCaller: ReadonlyMap<string, readonly DirectCall[]>;
}

interface IndexedDirectCall {
  readonly uri: string;
  readonly call: DirectCall;
}

const indexCallDocument = (snapshot: DocumentSnapshot): IndexedCallDocument => {
  const functions = new Map(
    snapshot.model.symbols
      .filter((symbol) => symbol.scopeId === "module" && symbol.kind === "function")
      .map((symbol) => [symbol.name, symbol]),
  );
  const calls = snapshot.model.directCalls().map((call) => ({ uri: snapshot.uri, call }));
  const callsByCaller = new Map<string, DirectCall[]>();
  for (const { call } of calls) {
    const callerCalls = callsByCaller.get(call.caller.name);
    if (callerCalls) callerCalls.push(call);
    else callsByCaller.set(call.caller.name, [call]);
  }
  return { snapshot, functions, calls, callsByCaller };
};

const toCallHierarchyItem = (uri: string, symbol: SemanticSymbol): CallHierarchyItem => ({
  name: symbol.name,
  kind: SymbolKind.Function,
  uri,
  range: toLspRange(symbol.definition.range),
  selectionRange: toLspRange(symbol.definition.range),
  data: { uri, name: symbol.name } satisfies CallHierarchyData,
});

const dataOf = (item: CallHierarchyItem): CallHierarchyData | undefined => {
  const data = item.data;
  if (!isRecord(data) || typeof data.uri !== "string" || typeof data.name !== "string") {
    return undefined;
  }
  return { uri: data.uri, name: data.name };
};

const toLspRange = (range: {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}): Range => ({
  start: { line: range.start.line, character: range.start.column },
  end: { line: range.end.line, character: range.end.column },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
