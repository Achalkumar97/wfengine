import { randomUUID } from "node:crypto";
import { collectAncestorIds } from "@wfengine/shared";
import type { WorkflowDefinition } from "@wfengine/shared";
import {
  buildAgentInvokeOnlyNotRunMessage,
  isLegacyLinearAgentInvokeOnlyPlaceholder,
} from "./agent-invoke-only.js";
import { createExecutionContext } from "./context.js";
import { topologicalSort } from "./dag.js";
import { createAgentToolDispatch } from "./agent-tool-dispatch.js";
import {
  buildInputData,
  createErrorOutput,
  runWithRetries,
} from "./executor.js";
import { formatStructuredNodeFailureMessage } from "./structured-node-failure.js";
import { WorkflowValidationError } from "./errors.js";
import { emitNodeComplete, emitNodeStart } from "./node-progress.js";
import type {
  ExecuteOptions,
  NodeDefinition,
  WorkflowExecuteResult,
  WorkflowLogger,
} from "./node.types.js";
import { outputsMapToRecord } from "./outputs-record.js";
import { NodeRegistry } from "./registry.js";
import { redactWorkflowExecuteResult } from "./redact-workflow-result.js";
import { parseWorkflowFromEngineInput } from "./workflow-input-parse.js";

/** Rich error text for Run inspector (always includes stack when available). */
export function formatCaughtNodeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const m = err.message ?? "";
  const trimmed = m.trim();
  if (
    trimmed.startsWith("{") &&
    trimmed.includes("__wfengineAgentFailure")
  ) {
    const trace =
      err.stack && !m.includes(err.stack)
        ? `\n\n--- Throw location ---\n${err.stack}`
        : "";
    return m + trace;
  }
  if (err.stack) {
    return `${m}\n\n--- JavaScript stack ---\n${err.stack}`;
  }
  return m;
}

export interface WorkflowEngineOptions {
  /** Shared registry; default new empty registry */
  registry?: NodeRegistry;
  defaultLogger?: WorkflowLogger;
}

/**
 * DAG workflow executor: validates JSON, walks nodes in topological order,
 * merges upstream outputs into each node's `inputData`, applies retries.
 */
export class WorkflowEngine {
  readonly registry: NodeRegistry;

  private readonly defaultLogger?: WorkflowLogger;

  constructor(options: WorkflowEngineOptions = {}) {
    this.registry = options.registry ?? new NodeRegistry();
    this.defaultLogger = options.defaultLogger;
  }

  registerNode(def: NodeDefinition): void {
    this.registry.register(def);
  }

  registerNodeReplace(def: NodeDefinition): void {
    this.registry.registerOrReplace(def);
  }

  /**
   * Execute a workflow from JSON string or object.
   */
  async execute(
    workflowInput: WorkflowDefinition | string | unknown,
    initialData?: unknown,
    options: ExecuteOptions = {},
  ): Promise<WorkflowExecuteResult> {
    const workflow = parseWorkflowFromEngineInput(workflowInput);

    const startedAt = new Date().toISOString();
    const executionId = options.executionId ?? randomUUID();

    const ctx = createExecutionContext({
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      executionId,
      variables: options.variables ?? {},
      logger: options.logger ?? this.defaultLogger,
      signal: options.signal,
    });

    const order = topologicalSort(workflow);
    const outputs = new Map<string, unknown>();
    const errors: Record<string, string> = {};
    const onNodeError = options.onNodeError ?? "stop";
    const notify = options.onNodeProgress;

    for (const nodeId of order) {
      const node = workflow.nodes.find((n) => n.id === nodeId);
      if (!node) {
        throw new WorkflowValidationError(`Missing node definition: ${nodeId}`);
      }

      const def = this.registry.require(node.type, node.id);

      emitNodeStart(notify, nodeId, node.type);

      const rawCfg = (node.config ?? {}) as Record<string, unknown>;
      if (rawCfg.wfengineToolOnly === true) {
        const prior = outputs.get(nodeId);
        if (
          prior !== undefined &&
          !isLegacyLinearAgentInvokeOnlyPlaceholder(prior)
        ) {
          emitNodeComplete(notify, {
            nodeId,
            nodeType: node.type,
            ok: true,
          });
          continue;
        }
        const msg = buildAgentInvokeOnlyNotRunMessage(nodeId, node.type);
        errors[nodeId] = msg;
        outputs.set(nodeId, createErrorOutput(nodeId, msg));
        ctx.logger.error(
          "engine: wfengineToolOnly node was never run via agent workflow_node tool",
          { nodeId, nodeType: node.type },
        );
        emitNodeComplete(notify, {
          nodeId,
          nodeType: node.type,
          ok: false,
          error: msg,
        });
        if (onNodeError === "stop") break;
        continue;
      }

      let config = node.config as Record<string, unknown>;
      if (def.configSchema) {
        const parsed = def.configSchema.safeParse(node.config ?? {});
        if (!parsed.success) {
          const msg = parsed.error.message;
          errors[nodeId] = msg;
          outputs.set(nodeId, createErrorOutput(nodeId, msg));
          emitNodeComplete(notify, {
            nodeId,
            nodeType: node.type,
            ok: false,
            error: msg,
          });
          if (onNodeError === "stop") break;
          continue;
        }
        config = parsed.data as Record<string, unknown>;
      }

      const inputData = buildInputData(
        workflow,
        nodeId,
        outputs,
        initialData,
        workflow.edges,
      );

      const childCtx = {
        ...ctx,
        logger: ctx.logger.child({ nodeId }),
      };

      const agentToolDispatch = createAgentToolDispatch({
        workflow,
        outputs,
        initialData,
        edges: workflow.edges,
        registry: this.registry,
        context: childCtx,
        callerNodeId: nodeId,
        retries: options.retries,
        signal: options.signal,
      });

      try {
        const out = await runWithRetries(
          def as NodeDefinition,
          {
            nodeId,
            nodeType: node.type,
            workflow,
            config,
            inputData,
            context: childCtx,
            agentToolDispatch,
          },
          options.retries,
          options.signal,
        );
        const structuredMsg = formatStructuredNodeFailureMessage(
          nodeId,
          node.type,
          out,
        );
        if (structuredMsg) {
          errors[nodeId] = structuredMsg;
          ctx.logger.warn("Node reported structured failure", {
            nodeId,
            nodeType: node.type,
            message: structuredMsg,
          });
          outputs.set(
            nodeId,
            onNodeError === "continue"
              ? createErrorOutput(nodeId, structuredMsg)
              : out,
          );
          emitNodeComplete(notify, {
            nodeId,
            nodeType: node.type,
            ok: false,
            error: structuredMsg,
          });
          if (onNodeError === "stop") break;
          continue;
        }
        outputs.set(nodeId, out);
        emitNodeComplete(notify, {
          nodeId,
          nodeType: node.type,
          ok: true,
        });
      } catch (err) {
        const message = formatCaughtNodeError(err);
        errors[nodeId] = message;
        ctx.logger.error("Node execution failed", { nodeId, message });

        emitNodeComplete(notify, {
          nodeId,
          nodeType: node.type,
          ok: false,
          error: message,
        });

        if (onNodeError === "continue") {
          outputs.set(nodeId, createErrorOutput(nodeId, message));
        } else {
          break;
        }
      }
    }

    const finishedAt = new Date().toISOString();
    const outputRecord = outputsMapToRecord(outputs);

    const failedKeys = Object.keys(errors);
    let status: WorkflowExecuteResult["status"];
    if (ctx.signal?.aborted && failedKeys.length > 0) {
      // If the run was aborted and the only errors are from the abort, mark cancelled.
      status = "cancelled";
    } else if (failedKeys.length === 0) {
      status = "completed";
    } else if (onNodeError === "continue") {
      status = "partial";
    } else {
      status = "failed";
    }

    return redactWorkflowExecuteResult({
      status,
      executionId,
      workflowId: workflow.id,
      outputs: outputRecord,
      errors,
      startedAt,
      finishedAt,
    });
  }

  /**
   * Run one node only, using cached outputs for each **direct parent** (same workflow graph).
   * Used by Studio to retry a failed step without re-running upstream nodes.
   */
  async executeSingleNode(
    workflowInput: WorkflowDefinition | string | unknown,
    targetNodeId: string,
    seedOutputs: Record<string, unknown>,
    initialData?: unknown,
    options: ExecuteOptions = {},
  ): Promise<WorkflowExecuteResult> {
    const workflow = parseWorkflowFromEngineInput(workflowInput);

    const node = workflow.nodes.find((n) => n.id === targetNodeId);
    if (!node) {
      throw new WorkflowValidationError(`Unknown node id: ${targetNodeId}`);
    }

    const ancestors = collectAncestorIds(targetNodeId, workflow.edges);
    for (const aid of ancestors) {
      if (!Object.prototype.hasOwnProperty.call(seedOutputs, aid)) {
        throw new WorkflowValidationError(
          `Missing cached output for upstream node "${aid}". Run the full workflow once, then use Re-run on this node.`,
        );
      }
    }

    const startedAt = new Date().toISOString();
    const executionId = options.executionId ?? randomUUID();

    const ctx = createExecutionContext({
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      executionId,
      variables: options.variables ?? {},
      logger: options.logger ?? this.defaultLogger,
      signal: options.signal,
    });

    const outputs = new Map<string, unknown>();
    for (const [k, v] of Object.entries(seedOutputs)) {
      outputs.set(k, v);
    }

    const notify = options.onNodeProgress;
    const def = this.registry.require(node.type, node.id);

    emitNodeStart(notify, targetNodeId, node.type);

    let config = node.config as Record<string, unknown>;
    if (def.configSchema) {
      const parsed = def.configSchema.safeParse(node.config ?? {});
      if (!parsed.success) {
        const msg = parsed.error.message;
        outputs.set(targetNodeId, createErrorOutput(targetNodeId, msg));
        emitNodeComplete(notify, {
          nodeId: targetNodeId,
          nodeType: node.type,
          ok: false,
          error: msg,
        });
        const finishedAtEarly = new Date().toISOString();
        const outputRecordEarly = outputsMapToRecord(outputs);
        return redactWorkflowExecuteResult({
          status: "failed",
          executionId,
          workflowId: workflow.id,
          outputs: outputRecordEarly,
          errors: { [targetNodeId]: msg },
          startedAt,
          finishedAt: finishedAtEarly,
        });
      }
      config = parsed.data as Record<string, unknown>;
    }

    const inputData = buildInputData(
      workflow,
      targetNodeId,
      outputs,
      initialData,
      workflow.edges,
    );

    const childCtx = {
      ...ctx,
      logger: ctx.logger.child({ nodeId: targetNodeId }),
    };

    const agentToolDispatch = createAgentToolDispatch({
      workflow,
      outputs,
      initialData,
      edges: workflow.edges,
      registry: this.registry,
      context: childCtx,
      callerNodeId: targetNodeId,
      retries: options.retries,
      signal: options.signal,
    });

    const errors: Record<string, string> = {};

    try {
      const out = await runWithRetries(
        def as NodeDefinition,
        {
          nodeId: targetNodeId,
          nodeType: node.type,
          workflow,
          config,
          inputData,
          context: childCtx,
          agentToolDispatch,
        },
        options.retries,
        options.signal,
      );
      const structuredMsg = formatStructuredNodeFailureMessage(
        targetNodeId,
        node.type,
        out,
      );
      if (structuredMsg) {
        errors[targetNodeId] = structuredMsg;
        ctx.logger.warn("Node reported structured failure", {
          nodeId: targetNodeId,
          nodeType: node.type,
          message: structuredMsg,
        });
        outputs.set(targetNodeId, out);
        emitNodeComplete(notify, {
          nodeId: targetNodeId,
          nodeType: node.type,
          ok: false,
          error: structuredMsg,
        });
      } else {
        outputs.set(targetNodeId, out);
        emitNodeComplete(notify, {
          nodeId: targetNodeId,
          nodeType: node.type,
          ok: true,
        });
      }
    } catch (err) {
      const message = formatCaughtNodeError(err);
      errors[targetNodeId] = message;
      ctx.logger.error("Node execution failed", {
        nodeId: targetNodeId,
        message,
      });
      outputs.set(targetNodeId, createErrorOutput(targetNodeId, message));
      emitNodeComplete(notify, {
        nodeId: targetNodeId,
        nodeType: node.type,
        ok: false,
        error: message,
      });
    }

    const finishedAt = new Date().toISOString();
    const outputRecord = outputsMapToRecord(outputs);

    const status: WorkflowExecuteResult["status"] =
      errors[targetNodeId] !== undefined ? "failed" : "completed";

    return redactWorkflowExecuteResult({
      status,
      executionId,
      workflowId: workflow.id,
      outputs: outputRecord,
      errors,
      startedAt,
      finishedAt,
    });
  }
}
