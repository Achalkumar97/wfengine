import { randomUUID } from "node:crypto";
import { collectAncestorIds, parseWorkflow } from "@wfengine/shared";
import type { WorkflowDefinition } from "@wfengine/shared";
import { createExecutionContext } from "./context.js";
import { topologicalSort } from "./dag.js";
import {
  buildInputData,
  createErrorOutput,
  runWithRetries,
} from "./executor.js";
import { WorkflowValidationError } from "./errors.js";
import type {
  ExecuteOptions,
  NodeDefinition,
  WorkflowExecuteResult,
  WorkflowLogger,
} from "./node.types.js";
import { NodeRegistry } from "./registry.js";
import { redactWorkflowExecuteResult } from "./redact-workflow-result.js";

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
    const workflow =
      typeof workflowInput === "string"
        ? parseWorkflow(JSON.parse(workflowInput) as unknown)
        : typeof workflowInput === "object" && workflowInput !== null
          ? parseWorkflow(workflowInput)
          : parseWorkflow(workflowInput);

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

      if (notify) {
        notify({
          phase: "start",
          nodeId,
          nodeType: node.type,
        });
      }

      let config = node.config as Record<string, unknown>;
      if (def.configSchema) {
        const parsed = def.configSchema.safeParse(node.config ?? {});
        if (!parsed.success) {
          const msg = parsed.error.message;
          errors[nodeId] = msg;
          outputs.set(nodeId, createErrorOutput(nodeId, msg));
          if (notify) {
            notify({
              phase: "complete",
              nodeId,
              nodeType: node.type,
              ok: false,
              error: msg,
            });
          }
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
          },
          options.retries,
          options.signal,
        );
        outputs.set(nodeId, out);
        if (notify) {
          notify({
            phase: "complete",
            nodeId,
            nodeType: node.type,
            ok: true,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors[nodeId] = message;
        ctx.logger.error("Node execution failed", { nodeId, message });

        if (notify) {
          notify({
            phase: "complete",
            nodeId,
            nodeType: node.type,
            ok: false,
            error: message,
          });
        }

        if (onNodeError === "continue") {
          outputs.set(nodeId, createErrorOutput(nodeId, message));
        } else {
          break;
        }
      }
    }

    const finishedAt = new Date().toISOString();
    const outputRecord: Record<string, unknown> = {};
    for (const [k, v] of outputs) outputRecord[k] = v;

    const failedKeys = Object.keys(errors);
    let status: WorkflowExecuteResult["status"];
    if (failedKeys.length === 0) {
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
    const workflow =
      typeof workflowInput === "string"
        ? parseWorkflow(JSON.parse(workflowInput) as unknown)
        : typeof workflowInput === "object" && workflowInput !== null
          ? parseWorkflow(workflowInput)
          : parseWorkflow(workflowInput);

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

    if (notify) {
      notify({
        phase: "start",
        nodeId: targetNodeId,
        nodeType: node.type,
      });
    }

    let config = node.config as Record<string, unknown>;
    if (def.configSchema) {
      const parsed = def.configSchema.safeParse(node.config ?? {});
      if (!parsed.success) {
        const msg = parsed.error.message;
        outputs.set(targetNodeId, createErrorOutput(targetNodeId, msg));
        if (notify) {
          notify({
            phase: "complete",
            nodeId: targetNodeId,
            nodeType: node.type,
            ok: false,
            error: msg,
          });
        }
        const finishedAtEarly = new Date().toISOString();
        const outputRecordEarly: Record<string, unknown> = {};
        for (const [k, v] of outputs) outputRecordEarly[k] = v;
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
        },
        options.retries,
        options.signal,
      );
      outputs.set(targetNodeId, out);
      if (notify) {
        notify({
          phase: "complete",
          nodeId: targetNodeId,
          nodeType: node.type,
          ok: true,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors[targetNodeId] = message;
      ctx.logger.error("Node execution failed", {
        nodeId: targetNodeId,
        message,
      });
      outputs.set(targetNodeId, createErrorOutput(targetNodeId, message));
      if (notify) {
        notify({
          phase: "complete",
          nodeId: targetNodeId,
          nodeType: node.type,
          ok: false,
          error: message,
        });
      }
    }

    const finishedAt = new Date().toISOString();
    const outputRecord: Record<string, unknown> = {};
    for (const [k, v] of outputs) outputRecord[k] = v;

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
