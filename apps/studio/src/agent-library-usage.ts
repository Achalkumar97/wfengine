import type { WfNodeData } from "@wfengine/ui";
import type { Node } from "reactflow";

function nodeUsesLibraryAgent(
  node: Node<WfNodeData>,
  agentId: string,
): boolean {
  const cfg = node.data.config;
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return false;
  const c = cfg as Record<string, unknown>;
  if (c.libraryAgentId === agentId) return true;
  const agents = c.agents;
  if (!Array.isArray(agents)) return false;
  for (const a of agents) {
    if (a && typeof a === "object" && !Array.isArray(a)) {
      if ((a as { libraryAgentId?: string }).libraryAgentId === agentId) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Counts how many open workflows (tabs) contain at least one node referencing this library agent.
 */
export function countWorkflowsUsingAgent(
  agentId: string,
  workflows: readonly { nodes: Node<WfNodeData>[] }[],
): number {
  let c = 0;
  for (const wf of workflows) {
    if (wf.nodes.some((n) => nodeUsesLibraryAgent(n, agentId))) c++;
  }
  return c;
}
