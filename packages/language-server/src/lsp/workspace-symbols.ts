import { SymbolKind, type SymbolInformation } from "vscode-languageserver";

import type { SemanticSymbol, SymbolKind as AnalyzerSymbolKind } from "@llvm-analyzer/analyzer";
import { makeDocumentSnapshot, type DocumentSnapshot } from "./features.ts";

const WORKSPACE_SYMBOL_KINDS = new Set<AnalyzerSymbolKind>([
  "function",
  "global",
  "type",
  "metadata",
  "attributeGroup",
  "comdat",
]);

const LSP_SYMBOL_KINDS: Readonly<Record<AnalyzerSymbolKind, SymbolKind>> = {
  attributeGroup: SymbolKind.Namespace,
  comdat: SymbolKind.Namespace,
  function: SymbolKind.Function,
  global: SymbolKind.Variable,
  label: SymbolKind.Key,
  local: SymbolKind.Variable,
  metadata: SymbolKind.Object,
  parameter: SymbolKind.Constant,
  type: SymbolKind.Struct,
};

/** Workspace Symbols provider の capability 宣言。 */
export const workspaceSymbolProviderCapability = true;

/**
 * `.ll` ファイル単位の解析結果から workspace/symbol 用の索引を保持する。
 *
 * @remarks
 * 索引は URI 単位で置き換える。ファイル変更時は `upsert`、削除時は `delete` を呼ぶことで
 * 古いシンボルが残らないようにする。
 */
export class WorkspaceSymbolIndex {
  private readonly symbolsByUri = new Map<string, readonly IndexedWorkspaceSymbol[]>();
  private readonly symbolsByTrigram = new Map<string, Set<IndexedWorkspaceSymbol>>();
  private readonly openUris = new Set<string>();
  private sortedSymbols: readonly IndexedWorkspaceSymbol[] | undefined;

  /**
   * ファイル内容を解析して索引へ登録する。
   *
   * @param uri ファイル URI。
   * @param text LLVM IR ソース。
   * @param version ドキュメントバージョン。ファイルシステム由来なら 1。
   */
  upsert(uri: string, text: string, version = 1): void {
    this.upsertFile(uri, text, version);
  }

  /**
   * ディスク上のファイル内容を索引へ登録する。
   *
   * @param uri ファイル URI。
   * @param text LLVM IR ソース。
   * @param version ドキュメントバージョン。ファイルシステム由来なら 1。
   *
   * @remarks
   * 同じ URI の open document がある場合、編集中 buffer を優先するためディスク内容では上書きしない。
   */
  upsertFile(uri: string, text: string, version = 1): void {
    if (this.openUris.has(uri)) return;
    this.upsertSnapshot(makeDocumentSnapshot(uri, text, version));
  }

  /**
   * open document の内容を索引へ登録する。
   *
   * @param uri ファイル URI。
   * @param text エディタ上の最新テキスト。
   * @param version ドキュメントバージョン。
   */
  upsertOpenDocument(uri: string, text: string, version: number): void {
    this.upsertOpenSnapshot(makeDocumentSnapshot(uri, text, version));
  }

  /**
   * 解析済みのopen documentを索引へ登録する。
   *
   * @param snapshot language serverが同じ更新に対して作ったスナップショット。
   *
   * @remarks
   * language serverの診断、Workspace Symbols、Call Hierarchyで同じ解析結果を共有し、
   * 巨大IRを機能ごとに再解析しないために使う。
   */
  upsertOpenSnapshot(snapshot: DocumentSnapshot): void {
    this.openUris.add(snapshot.uri);
    this.upsertSnapshot(snapshot);
  }

  /**
   * open document を閉じたあと、ディスク内容へ戻すか索引を破棄する。
   *
   * @param uri ファイル URI。
   * @param diskText 閉じた時点のディスク内容。読めなければ undefined。
   */
  closeOpenDocument(uri: string, diskText?: string): void {
    if (diskText === undefined) {
      this.closeOpenSnapshot(uri);
      return;
    }
    this.closeOpenSnapshot(uri, makeDocumentSnapshot(uri, diskText));
  }

  /**
   * open documentを閉じ、解析済みのディスク内容へ索引を戻す。
   *
   * @param uri 閉じたドキュメントのURI。
   * @param snapshot ディスク内容のスナップショット。読めなければ省略する。
   */
  closeOpenSnapshot(uri: string, snapshot?: DocumentSnapshot): void {
    this.openUris.delete(uri);
    if (!snapshot) {
      this.delete(uri);
      return;
    }
    this.upsertSnapshot(snapshot);
  }

  /**
   * 解析済み snapshot を索引へ登録する。
   *
   * @param snapshot 登録するドキュメント snapshot。
   */
  upsertSnapshot(snapshot: DocumentSnapshot): void {
    this.removeSymbols(snapshot.uri);
    const symbols = workspaceSymbolsOf(snapshot).map(indexWorkspaceSymbol);
    this.symbolsByUri.set(snapshot.uri, symbols);
    for (const symbol of symbols) {
      for (const trigram of symbol.trigrams) {
        const matches = this.symbolsByTrigram.get(trigram);
        if (matches) matches.add(symbol);
        else this.symbolsByTrigram.set(trigram, new Set([symbol]));
      }
    }
    this.sortedSymbols = undefined;
  }

  /**
   * URI に対応するファイルの索引を破棄する。
   *
   * @param uri 削除または対象外になったファイル URI。
   */
  delete(uri: string): void {
    this.openUris.delete(uri);
    this.removeSymbols(uri);
  }

  /**
   * query に一致する workspace symbol を返す。
   *
   * @param query LSP workspace/symbol の query。空文字なら全件。
   * @returns URI・位置付きの workspace symbol。
   */
  search(query: string): SymbolInformation[] {
    const normalizedQuery = query.toLocaleLowerCase();
    return this.candidatesFor(normalizedQuery)
      .filter((symbol) => symbol.normalizedName.includes(normalizedQuery))
      .map((symbol) => symbol.information)
      .toSorted(compareSymbolInformation);
  }

  private candidatesFor(query: string): readonly IndexedWorkspaceSymbol[] {
    if (query.length < 3) return this.allSymbols();
    const trigrams = trigramsOf(query);
    const candidateSets = trigrams
      .map((trigram) => this.symbolsByTrigram.get(trigram))
      .filter((symbols): symbols is Set<IndexedWorkspaceSymbol> => symbols !== undefined)
      .toSorted((left, right) => left.size - right.size);
    if (candidateSets.length !== trigrams.length) return [];
    return [...candidateSets[0]!];
  }

  private allSymbols(): readonly IndexedWorkspaceSymbol[] {
    this.sortedSymbols ??= [...this.symbolsByUri.values()]
      .flat()
      .toSorted((left, right) => compareSymbolInformation(left.information, right.information));
    return this.sortedSymbols;
  }

  private removeSymbols(uri: string): void {
    const previous = this.symbolsByUri.get(uri);
    if (!previous) return;
    for (const symbol of previous) {
      for (const trigram of symbol.trigrams) {
        const matches = this.symbolsByTrigram.get(trigram)!;
        matches.delete(symbol);
        if (matches.size === 0) this.symbolsByTrigram.delete(trigram);
      }
    }
    this.symbolsByUri.delete(uri);
    this.sortedSymbols = undefined;
  }
}

interface IndexedWorkspaceSymbol {
  readonly information: SymbolInformation;
  readonly normalizedName: string;
  readonly trigrams: readonly string[];
}

const indexWorkspaceSymbol = (information: SymbolInformation): IndexedWorkspaceSymbol => {
  const normalizedName = information.name.toLocaleLowerCase();
  return { information, normalizedName, trigrams: trigramsOf(normalizedName) };
};

const trigramsOf = (value: string): string[] => {
  if (value.length < 3) return [];
  return [
    ...new Set(
      Array.from({ length: value.length - 2 }, (_, index) => value.slice(index, index + 3)),
    ),
  ];
};

const workspaceSymbolsOf = (snapshot: DocumentSnapshot): SymbolInformation[] =>
  snapshot.model.symbols
    .filter((symbol) => symbol.scopeId === "module" && WORKSPACE_SYMBOL_KINDS.has(symbol.kind))
    .map((symbol) => toSymbolInformation(snapshot.uri, symbol));

const toSymbolInformation = (uri: string, symbol: SemanticSymbol): SymbolInformation => ({
  name: symbol.name,
  kind: LSP_SYMBOL_KINDS[symbol.kind],
  location: {
    uri,
    range: {
      start: {
        line: symbol.definition.range.start.line,
        character: symbol.definition.range.start.column,
      },
      end: {
        line: symbol.definition.range.end.line,
        character: symbol.definition.range.end.column,
      },
    },
  },
  containerName: symbol.scopeName,
});

const compareSymbolInformation = (a: SymbolInformation, b: SymbolInformation): number => {
  const uriOrder = a.location.uri.localeCompare(b.location.uri);
  if (uriOrder !== 0) return uriOrder;
  return a.location.range.start.line - b.location.range.start.line;
};
