import type { Edge, Node } from "reactflow";
import type { WorkflowDefinition } from "@wfengine/shared";
import { WorkflowDefinitionSchema } from "@wfengine/shared";

export interface WfNodeData extends Record<string, unknown> {
  wfType: string;
  label: string;
  config: Record<string, unknown>;
}

/** Build React Flow state from a validated definition (grid positions). */
export function workflowDefinitionToFlowState(
  def: WorkflowDefinition,
  resolveLabel: (type: string) => string,
): { nodes: Node<WfNodeData>[]; edges: Edge[] } {
  const nodes: Node<WfNodeData>[] = def.nodes.map((n, i) => ({
    id: n.id,
    type: "wfNode",
    position: {
      x: 80 + (i % 5) * 260,
      y: 80 + Math.floor(i / 5) * 140,
    },
    data: {
      wfType: n.type,
      label: resolveLabel(n.type),
      config: n.config ?? {},
    },
  }));

  const edges: Edge[] = def.edges.map((e, i) => ({
    id: `e-${e.source}-${e.target}-${i}`,
    source: e.source,
    target: e.target,
    type: "turboGradient",
    animated: true,
  }));

  return { nodes, edges };
}

/**
 * Serialize React Flow state into a wfengine WorkflowDefinition JSON.
 */
export function exportWorkflowDefinition(
  workflowId: string,
  version: number | undefined,
  nodes: Node<WfNodeData>[],
  edges: Edge[],
): WorkflowDefinition {
  const def = {
    id: workflowId,
    ...(version !== undefined ? { version } : {}),
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.wfType,
      config: n.data.config ?? {},
    })),
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
    })),
  };
  return WorkflowDefinitionSchema.parse(def);
}
