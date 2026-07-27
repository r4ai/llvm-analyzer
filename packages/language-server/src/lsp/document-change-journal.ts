import type { TextDocumentContentChangeEvent } from "vscode-languageserver";

interface PendingChanges {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly changes: readonly TextDocumentContentChangeEvent[];
}

/**
 * debounce中のLSP変更を、ドキュメントとバージョンの連続性を保って記録する。
 */
export class DocumentChangeJournal {
  private readonly pending = new Map<string, PendingChanges>();

  /**
   * 一回のLSP変更通知を記録する。
   *
   * @param uri ドキュメントURI。
   * @param fromVersion 適用前のバージョン。
   * @param toVersion 適用後のバージョン。
   * @param changes 通知された順序付き変更列。
   */
  record(
    uri: string,
    fromVersion: number,
    toVersion: number,
    changes: readonly TextDocumentContentChangeEvent[],
  ): void {
    const previous = this.pending.get(uri);
    this.pending.set(uri, {
      fromVersion: previous?.toVersion === fromVersion ? previous.fromVersion : fromVersion,
      toVersion,
      changes:
        previous?.toVersion === fromVersion ? [...previous.changes, ...changes] : [...changes],
    });
  }

  /**
   * 指定したバージョン間の変更列を一度だけ返す。
   *
   * @param uri ドキュメントURI。
   * @param fromVersion 解析済みスナップショットのバージョン。
   * @param toVersion 最新ドキュメントのバージョン。
   * @returns バージョンが一致する変更列。不一致または未記録なら`undefined`。
   */
  consume(
    uri: string,
    fromVersion: number,
    toVersion: number,
  ): readonly TextDocumentContentChangeEvent[] | undefined {
    const pending = this.pending.get(uri);
    this.pending.delete(uri);
    return pending?.fromVersion === fromVersion && pending.toVersion === toVersion
      ? pending.changes
      : undefined;
  }

  /**
   * ドキュメントに残る変更列を破棄する。
   *
   * @param uri ドキュメントURI。
   */
  delete(uri: string): void {
    this.pending.delete(uri);
  }
}
