import type { WorkflowDefinition } from "@wfengine/shared";

/**
 * When unset in config: if this team calls `workflow_node` tools that point at **tool-only** graph nodes and
 * `maxTurns === agents.length` (one turn per persona), default to pipeline mode so OpenAI is asked to use tools
 * on the executor turn. Avoids “everything skipped” when Studio left maxTurns at 8 or binding unset.
 */
export function inferDefaultMultiAgentToolBinding(opts: {
  tools: readonly { kind: string; nodeId?: string }[] | undefined;
  maxTurns: number;
  agentsCount: number;
  workflow: WorkflowDefinition;
}): "openai_tools_auto" | "pipeline_last_turn_tools_required" {
  const wfNodeTools = (opts.tools ?? []).filter(
    (t): t is { kind: "workflow_node"; nodeId: string } =>
      t.kind === "workflow_node" && typeof t.nodeId === "string",
  );
  if (wfNodeTools.length === 0) return "openai_tools_auto";
  const targetsToolOnlyNode = wfNodeTools.some((ref) => {
    const n = opts.workflow.nodes.find((x) => x.id === ref.nodeId);
    const cfg = (n?.config ?? {}) as Record<string, unknown>;
    return cfg.wfengineToolOnly === true;
  });
  if (!targetsToolOnlyNode) return "openai_tools_auto";
  if (opts.agentsCount < 1 || opts.maxTurns < 1) return "openai_tools_auto";
  if (opts.maxTurns !== opts.agentsCount) return "openai_tools_auto";
  return "pipeline_last_turn_tools_required";
}

/**
 * Root cause of “tools ignored” with OpenAI-compatible APIs: `tool_choice: "auto"` allows the model to
 * respond with plain text and never emit `tool_calls`. Binding modes describe when we use `required` on
 * the first completion of a turn so workflow_node tools actually run.
 */
export function shouldRequireToolsFirstCompletion(opts: {
  turn: number;
  maxTurns: number;
  agentsCount: number;
  binding: "openai_tools_auto" | "pipeline_last_turn_tools_required";
  explicitIndices?: readonly number[] | undefined;
}): boolean {
  if (opts.explicitIndices?.includes(opts.turn)) return true;
  if (opts.binding !== "pipeline_last_turn_tools_required") return false;
  if (opts.agentsCount < 1 || opts.maxTurns < 1) return false;
  /** One full round-robin (each agent exactly once): last turn is the usual “executor” slot. */
  if (opts.maxTurns !== opts.agentsCount) return false;
  return opts.turn === opts.maxTurns - 1;
}
