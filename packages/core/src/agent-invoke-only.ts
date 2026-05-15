/**
 * Helpers for {@link WorkflowEngine} when `config.wfengineToolOnly` is set:
 * those nodes are scheduled only via agent `workflow_node` tool dispatch, not as duplicate DAG steps.
 *
 * @see createAgentToolDispatch
 */

/** Legacy Run inspector output from older engine versions (before hard-fail on missing tool runs). */
export const LEGACY_LINEAR_AGENT_INVOKE_ONLY_NOTE =
  "Skipped in linear DAG pass; runs only when invoked as an agent workflow_node tool.";

/**
 * Detects historical placeholder rows so we do not treat them as successful agent runs.
 */
export function isLegacyLinearAgentInvokeOnlyPlaceholder(out: unknown): boolean {
  if (out === null || typeof out !== "object" || Array.isArray(out)) {
    return false;
  }
  const o = out as Record<string, unknown>;
  return (
    o.__wfengineToolOnly === true && o.note === LEGACY_LINEAR_AGENT_INVOKE_ONLY_NOTE
  );
}

/**
 * User-facing error when the scheduler reaches an agent-invoke-only node that was never executed via tools.
 */
export function buildAgentInvokeOnlyNotRunMessage(
  nodeId: string,
  nodeType: string,
): string {
  return [
    `Node "${nodeId}" (${nodeType}) is marked agent-invoke-only (config.wfengineToolOnly).`,
    `No upstream agent executed it as a workflow_node tool with this node id before the scheduler reached it.`,
    `Fix: add workflow_node tools on the multi-agent node whose nodeIds match "${nodeId}", and ensure the model calls them; or turn off agent-invoke-only so this step runs as a normal DAG node (pure linear workflows).`,
  ].join(" ");
}
