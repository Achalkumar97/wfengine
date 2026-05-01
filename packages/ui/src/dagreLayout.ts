import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "reactflow";
import type { WfNodeData } from "./exportWorkflow.js";

const NODE_W = 260;
const NODE_H = 96;

/**
 * Apply layered auto-layout (TB) using Dagre. Mutates positions only.
 */
export function layoutNodesDagre(
  nodes: Node<WfNodeData>[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
): Node<WfNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: 80,
    nodesep: 48,
    marginx: 40,
    marginy: 40,
  });

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    if (!nodeWithPosition) return node;
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_W / 2,
        y: nodeWithPosition.y - NODE_H / 2,
      },
    };
  });
}
