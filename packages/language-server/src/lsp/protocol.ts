/** 解析済みスナップショットからCFGを取得する独自LSP request名。 */
export const CONTROL_FLOW_GRAPH_REQUEST = "llvm-analyzer/controlFlowGraph";

/** CFG requestの入力。 */
export interface ControlFlowGraphRequestParams {
  /** 対象ドキュメント。 */
  readonly textDocument: {
    readonly uri: string;
  };
  /** CFGを取得する関数内の位置。 */
  readonly position: {
    readonly line: number;
    readonly character: number;
  };
}

/**
 * 外部から届いた値がCFG requestの入力契約を満たすか検証する。
 *
 * @param value JSON-RPCで受信した未検証値。
 * @returns URIと非負の位置を持つならtrue。
 */
export const isControlFlowGraphRequestParams = (
  value: unknown,
): value is ControlFlowGraphRequestParams => {
  if (!isRecord(value) || !isRecord(value.textDocument) || !isRecord(value.position)) {
    return false;
  }
  return (
    typeof value.textDocument.uri === "string" &&
    isNonNegativeInteger(value.position.line) &&
    isNonNegativeInteger(value.position.character)
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
