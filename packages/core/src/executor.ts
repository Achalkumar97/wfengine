import {
  collectAncestorIds,
  type WorkflowDefinition,
  type WorkflowEdge,
} from "@wfengine/shared";
import { topologicalSort } from "./dag.js";
import type {
  ExecuteParams,
  NodeDefinition,
  RetryPolicy,
  WorkflowExecutionContext,
} from "./node.types.js";

const ERROR_KEY = "__wfengine_error";

/** Repo identity fields merged from all upstream nodes so later steps inherit analyze/read context without re-copying config. */
const REPO_PASS_THROUGH_KEYS = [
  "gitOwner",
  "gitRepo",
  "gitRef",
  "repoInfo",
  "githubToken",
] as const;

function mergeRepoIdentityFromAncestors(
  workflow: WorkflowDefinition,
  nodeId: string,
  outputs: Map<string, unknown>,
  edges: WorkflowEdge[],
  input: Record<string, unknown>,
): void {
  let order: string[];
  try {
    order = topologicalSort(workflow);
  } catch {
    return;
  }
  const ancestors = collectAncestorIds(nodeId, edges);
  if (ancestors.length === 0) return;
  const orderIndex = new Map(order.map((id, i) => [id, i]));
  const sorted = [...ancestors].sort(
    (a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0),
  );
  for (const aid of sorted) {
    const out = outputs.get(aid);
    if (!out || typeof out !== "object" || Array.isArray(out)) continue;
    const o = out as Record<string, unknown>;
    for (const key of REPO_PASS_THROUGH_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(o, key)) continue;
      const v = o[key];
      if (v === undefined || v === null) continue;
      if (
        typeof v === "string" &&
        (key === "gitOwner" || key === "gitRepo" || key === "gitRef") &&
        v.trim().length === 0
      ) {
        continue;
      }
      input[key] = v;
    }
  }
}

export function createErrorOutput(
  nodeId: string,
  message: string,
): Record<string, unknown> {
  return {
    [ERROR_KEY]: { nodeId, message },
    __wfengine_success: false,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function computeDelayMs(
  attempt: number,
  policy: RetryPolicy,
): number {
  const initial = policy.initialDelayMs ?? 100;
  const mult = policy.backoffMultiplier ?? 2;
  const max = policy.maxDelayMs ?? 10_000;
  const raw = initial * Math.pow(mult, Math.max(0, attempt - 1));
  return Math.min(raw, max);
}

/**
 * Run node execute with retries; returns output or throws last error.
 */
export async function runWithRetries<TConfig extends Record<string, unknown>>(
  def: NodeDefinition<TConfig>,
  params: Omit<ExecuteParams<TConfig>, "attempt">,
  policy: RetryPolicy | undefined,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const maxAttempts = Math.max(1, policy?.maxAttempts ?? 1);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      const e = new Error("Aborted");
      e.name = "AbortError";
      throw e;
    }
    try {
      return await def.execute({ ...params, attempt });
    } catch (err) {
      lastErr = err;
      params.context.logger.warn("Node attempt failed", {
        nodeId: params.nodeId,
        type: params.nodeType,
        attempt,
        maxAttempts,
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempt < maxAttempts) {
        await sleep(computeDelayMs(attempt, policy ?? {}));
      }
    }
  }

  throw lastErr;
}

/**
 * Merge workflow initial payload + parent outputs for each node.
 * Initial data is always merged first so triggers/actions can return focused
 * outputs without losing the execute payload for downstream nodes.
 */
export function buildInputData(
  workflow: WorkflowDefinition,
  nodeId: string,
  outputs: Map<string, unknown>,
  initialData: unknown,
  edges: WorkflowEdge[],
): Record<string, unknown> {
  const parents = edges.filter((e) => e.target === nodeId).map((e) => e.source);
  const input: Record<string, unknown> = {};

  if (initialData !== undefined && initialData !== null) {
    if (typeof initialData === "object" && !Array.isArray(initialData)) {
      Object.assign(input, initialData as Record<string, unknown>);
    } else {
      input._initial = initialData;
    }
  }

  for (const p of parents) {
    const out = outputs.get(p);
    mergeParentOutput(input, out, p);
  }

  mergeRepoIdentityFromAncestors(workflow, nodeId, outputs, edges, input);

  return input;
}

function mergeParentOutput(
  target: Record<string, unknown>,
  value: unknown,
  parentId: string,
): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    Object.assign(target, value as Record<string, unknown>);
  } else {
    target[parentId] = value;
  }
}
