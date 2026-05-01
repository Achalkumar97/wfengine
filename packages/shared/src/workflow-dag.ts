import type { WorkflowDefinition, WorkflowEdge } from "./workflow.schema.js";

/** Thrown when workflow edges form a cycle so no topological order exists. */
export class CyclicWorkflowError extends Error {
  readonly name = "CyclicWorkflowError";
  constructor(message = "Workflow graph contains a cycle") {
    super(message);
  }
}

/**
 * Topological order of node ids (respects edges source → target).
 * Throws {@link CyclicWorkflowError} if the graph has a cycle.
 * Pure function — safe for browser bundles (no Node builtins).
 */
export function topologicalSort(workflow: WorkflowDefinition): string[] {
  const nodeIds = new Set(workflow.nodes.map((n) => n.id));
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    indegree.set(id, 0);
    adj.set(id, []);
  }

  for (const e of workflow.edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      throw new Error(`Edge references unknown node: ${e.source} → ${e.target}`);
    }
    adj.get(e.source)?.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, d] of indegree) {
    if (d === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    order.push(u);
    for (const v of adj.get(u) ?? []) {
      const next = (indegree.get(v) ?? 0) - 1;
      indegree.set(v, next);
      if (next === 0) queue.push(v);
    }
  }

  if (order.length !== nodeIds.size) {
    throw new CyclicWorkflowError();
  }

  return order;
}

/** Nodes with no incoming edges */
export function entryNodeIds(workflow: WorkflowDefinition): Set<string> {
  const targets = new Set(workflow.edges.map((e) => e.target));
  return new Set(
    workflow.nodes.map((n) => n.id).filter((id) => !targets.has(id)),
  );
}

/**
 * All nodes upstream of `nodeId` (every node that has a directed path to `nodeId`),
 * excluding `nodeId` itself.
 */
export function collectAncestorIds(
  nodeId: string,
  edges: WorkflowEdge[],
): string[] {
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }
  const seen = new Set<string>();
  const stack = [...(incoming.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of incoming.get(id) ?? []) stack.push(p);
  }
  return [...seen];
}
