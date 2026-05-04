import {
  collectAncestorIds,
  type WorkflowDefinition,
  type WorkflowEdge,
} from "@wfengine/shared";
import {
  buildInputData,
  runWithRetries,
} from "./executor.js";
import { WorkflowValidationError } from "./errors.js";
import type {
  AgentToolDispatch,
  ExecuteOptions,
  NodeDefinition,
  WorkflowExecutionContext,
} from "./node.types.js";
import type { NodeRegistry } from "./registry.js";

/** Maximum nested workflow_node tool executions (prevents runaway recursion). */
export const MAX_AGENT_TOOL_DEPTH = 6;

export interface CreateAgentToolDispatchParams {
  workflow: WorkflowDefinition;
  outputs: Map<string, unknown>;
  initialData: unknown;
  edges: WorkflowEdge[];
  registry: NodeRegistry;
  /** Context for the node that requested tools (depth comes from variables.__wfAgentToolDepth) */
  context: WorkflowExecutionContext;
  /** Current graph node id — cannot target self as a workflow_node tool */
  callerNodeId: string;
  retries: ExecuteOptions["retries"];
  signal: AbortSignal | undefined;
}

/**
 * Invoke another workflow node using the same partial outputs map as the active run.
 * Used by agent nodes when the model requests a `workflow_node` tool.
 */
export function createAgentToolDispatch(
  params: CreateAgentToolDispatchParams,
): AgentToolDispatch {
  const selfRef: { current: AgentToolDispatch | null } = { current: null };

  const dispatch: AgentToolDispatch = {
    executeWorkflowNode: async (targetNodeId, args) => {
      const depth =
        Number(params.context.variables.__wfAgentToolDepth) || 0;
      if (depth >= MAX_AGENT_TOOL_DEPTH) {
        throw new WorkflowValidationError(
          `Agent workflow_node tools exceeded max nesting depth (${MAX_AGENT_TOOL_DEPTH})`,
        );
      }
      if (targetNodeId === params.callerNodeId) {
        throw new WorkflowValidationError(
          `workflow_node tool cannot reference the current agent node (${targetNodeId})`,
        );
      }

      const node = params.workflow.nodes.find((n) => n.id === targetNodeId);
      if (!node) {
        const defined = params.workflow.nodes.map((n) => n.id).join(", ");
        throw new WorkflowValidationError(
          `Unknown workflow node id for tool: "${targetNodeId}". This must match a node \`id\` on the canvas. Defined ids: ${defined || "(none)"}. Update the multi-agent tool list or rename the node so ids match (Studio often generates ids like email.send-… when you add from the palette).`,
        );
      }

      const ancestors = collectAncestorIds(targetNodeId, params.edges);
      for (const aid of ancestors) {
        /** Caller is still executing; its row is not in `outputs` until the node completes. */
        if (aid === params.callerNodeId) continue;
        if (!params.outputs.has(aid)) {
          throw new WorkflowValidationError(
            `workflow_node "${targetNodeId}": upstream "${aid}" has no output yet — that step must run before this agent in the graph`,
          );
        }
      }

      const baseInput = buildInputData(
        params.workflow,
        targetNodeId,
        params.outputs,
        params.initialData,
        params.edges,
      );
      const inputData =
        args !== undefined &&
        typeof args === "object" &&
        !Array.isArray(args)
          ? { ...baseInput, ...args }
          : baseInput;

      const def = params.registry.require(node.type, node.id);
      let config = node.config as Record<string, unknown>;
      if (def.configSchema) {
        const parsed = def.configSchema.safeParse(node.config ?? {});
        if (!parsed.success) {
          throw new WorkflowValidationError(
            `workflow_node "${targetNodeId}": ${parsed.error.message}`,
          );
        }
        config = parsed.data as Record<string, unknown>;
      }

      const childCtx: WorkflowExecutionContext = {
        ...params.context,
        logger: params.context.logger.child({ wfengineToolTarget: targetNodeId }),
        variables: {
          ...params.context.variables,
          __wfAgentToolDepth: depth + 1,
        },
      };

      const out = await runWithRetries(
        def as NodeDefinition,
        {
          nodeId: targetNodeId,
          nodeType: node.type,
          workflow: params.workflow,
          config,
          inputData,
          context: childCtx,
          agentToolDispatch: selfRef.current ?? dispatch,
        },
        params.retries,
        params.signal,
      );
      /** So chained tools (e.g. write CSV → email) see upstream tool outputs in buildInputData. */
      params.outputs.set(targetNodeId, out);
      const vars = params.context.variables as Record<string, unknown>;
      const key = "__wfengineWorkflowNodeInvocationCount";
      const prev = vars[key];
      vars[key] =
        (typeof prev === "number" && Number.isFinite(prev) ? prev : 0) + 1;
      return out;
    },
  };

  selfRef.current = dispatch;
  return dispatch;
}
