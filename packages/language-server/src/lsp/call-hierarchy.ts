import {
  SymbolKind,
  type CallHierarchyIncomingCall,
  type CallHierarchyItem,
  type CallHierarchyOutgoingCall,
  type Position,
  type Range,
} from "vscode-languageserver";

import type { SemanticSymbol } from "@llvm-analyzer/analyzer";
import { makeDocumentSnapshot, type DocumentSnapshot } from "./features.ts";

export const callHierarchyProviderCapability = true;

interface CallHierarchyData {
  readonly uri: string;
  readonly name: string;
}

/** 解析済み `.ll` ファイル群から直接呼び出し階層を返す索引。 */
export class CallHierarchyIndex {
  private readonly snapshots = new Map<string, DocumentSnapshot>();

  upsert(uri: string, text: string, version = 1): void {
    this.upsertSnapshot(makeDocumentSnapshot(uri, text, version));
  }

  upsertSnapshot(snapshot: DocumentSnapshot): void {
    this.snapshots.set(snapshot.uri, snapshot);
  }

  delete(uri: string): void {
    this.snapshots.delete(uri);
  }

  prepare(uri: string, position: Position): CallHierarchyItem[] {
    const snapshot = this.snapshots.get(uri);
    if (!snapshot) return [];
    const symbol = snapshot.model.symbolAt({
      offset: snapshot.document.offsetAt(position),
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
    for (const snapshot of this.snapshots.values()) {
      for (const call of snapshot.model
        .directCalls()
        .filter((entry) => entry.callee.name === target.name)) {
        const caller = functionSymbol(snapshot, call.caller.name);
        if (!caller) continue;
        const key = `${snapshot.uri}\0${caller.name}`;
        const existing = calls.get(key);
        if (existing) existing.fromRanges.push(toLspRange(call.range));
        else {
          calls.set(key, {
            from: toCallHierarchyItem(snapshot.uri, caller),
            fromRanges: [toLspRange(call.range)],
          });
        }
      }
    }
    return [...calls.values()];
  }

  outgoing(item: CallHierarchyItem): CallHierarchyOutgoingCall[] {
    const source = dataOf(item);
    if (!source) return [];
    const snapshot = this.snapshots.get(source.uri);
    if (!snapshot) return [];
    const calls = new Map<string, CallHierarchyOutgoingCall>();
    for (const call of snapshot.model
      .directCalls()
      .filter((entry) => entry.caller.name === source.name)) {
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
    for (const snapshot of this.snapshots.values()) {
      const symbol = functionSymbol(snapshot, name);
      if (symbol) return { uri: snapshot.uri, symbol };
    }
    return undefined;
  }
}

const functionSymbol = (snapshot: DocumentSnapshot, name: string): SemanticSymbol | undefined =>
  snapshot.model.symbols.find(
    (symbol) => symbol.scopeId === "module" && symbol.kind === "function" && symbol.name === name,
  );

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
