import { CallHierarchyIndex } from "./call-hierarchy.ts";
import type { DocumentSnapshot } from "./features.ts";
import { WorkspaceSymbolIndex } from "./workspace-symbols.ts";

/**
 * open documentのsnapshotを、要求時にWorkspace SymbolsとCall Hierarchyへ反映する。
 *
 * @remarks
 * Definition、Hover、Referencesは`DocumentSnapshot`の意味モデルだけを使う。
 * それらの位置操作を無関係な索引構築から分離するため、最新snapshotをURI単位で保留し、
 * 派生索引を利用する要求の直前にだけfan-outする。
 */
export class SnapshotDerivedIndexes {
  private readonly pending = new Map<string, DocumentSnapshot>();
  private readonly workspaceSymbols: WorkspaceSymbolIndex;
  private readonly callHierarchy: CallHierarchyIndex;

  constructor(workspaceSymbols: WorkspaceSymbolIndex, callHierarchy: CallHierarchyIndex) {
    this.workspaceSymbols = workspaceSymbols;
    this.callHierarchy = callHierarchy;
  }

  /**
   * URIの最新snapshotを派生索引の反映待ちにする。
   *
   * @param snapshot parserとanalyzer済みの不変snapshot。
   */
  defer(snapshot: DocumentSnapshot): void {
    const pending = this.pending.get(snapshot.uri);
    if (pending && pending.version > snapshot.version) return;
    this.pending.set(snapshot.uri, snapshot);
  }

  /**
   * 指定URIに保留中のsnapshotがあれば、両方の派生索引へ一度だけ反映する。
   *
   * @param uri 最新化するopen documentのURI。
   */
  ensure(uri: string): void {
    const snapshot = this.pending.get(uri);
    if (!snapshot) return;
    this.workspaceSymbols.upsertOpenSnapshot(snapshot);
    this.callHierarchy.upsertSnapshot(snapshot);
    this.pending.delete(uri);
  }

  /** 保留中の全URIを派生索引へ反映する。 */
  ensureAll(): void {
    for (const uri of this.pending.keys()) this.ensure(uri);
  }

  /**
   * URIに保留中のsnapshotを、派生索引へ反映せず破棄する。
   *
   * @param uri 閉じる、または削除するdocumentのURI。
   */
  discard(uri: string): void {
    this.pending.delete(uri);
  }
}
