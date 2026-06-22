import type { ControlFlowBlock, ControlFlowEdge, ControlFlowGraph } from "./types.ts";

/**
 * CFG を Mermaid flowchart として出力する。
 *
 * @param graph 関数単位の CFG。
 * @returns Mermaid `flowchart TD` テキスト。
 */
export const formatControlFlowGraphAsMermaid = (graph: ControlFlowGraph): string => {
  const lines = ["flowchart TD"];
  const ids = new Map(graph.blocks.map((block, index) => [block.name, nodeId(index)]));
  for (let index = 0; index < graph.blocks.length; index += 1) {
    const block = graph.blocks[index];
    if (!block) continue;
    lines.push(`  ${nodeId(index)}["${escapeMermaidLabel(block.name)}"]`);
  }
  for (const edge of graph.edges) {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (from && to) lines.push(`  ${from} --> ${to}`);
  }
  return lines.join("\n");
};

export const nodeId = (index: number): string => `block_${index}`;

const escapeMermaidLabel = (label: string): string => label.replace(/"/gu, '\\"');

export type { ControlFlowBlock, ControlFlowEdge, ControlFlowGraph };
