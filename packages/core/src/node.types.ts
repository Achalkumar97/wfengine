import type { z } from "zod";
import type { WorkflowDefinition } from "@wfengine/shared";

/** Nested `workflow_node` tool execution (see {@link WorkflowEngine}) */
export interface AgentToolDispatch {
  executeWorkflowNode: (
    targetNodeId: string,
    args?: Record<string, unknown>,
  ) => Promise<unknown>;
}

/**
 * Logger available to node `execute` handlers (structured, child scopes).
 */
export interface WorkflowLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): WorkflowLogger;
}

/** Per-run context passed to every node execution */
export interface WorkflowExecutionContext {
  /** Unique id for this execution */
  executionId: string;
  workflowId: string;
  workflowVersion?: number;
  variables: Record<string, unknown>;
  logger: WorkflowLogger;
  signal?: AbortSignal | undefined;
}

/** Retry behavior when `execute` throws */
export interface RetryPolicy {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
}

export interface ExecuteParams<TConfig = Record<string, unknown>> {
  nodeId: string;
  nodeType: string;
  workflow: WorkflowDefinition;
  config: TConfig;
  /** Merged upstream outputs + optional initial payload for entry nodes */
  inputData: Record<string, unknown>;
  context: WorkflowExecutionContext;
  /** 1-based attempt number */
  attempt: number;
  /**
   * Wired by {@link WorkflowEngine} so agent nodes can run `workflow_node` tools during an LLM loop.
   */
  agentToolDispatch?: AgentToolDispatch | undefined;
}

export type NodeCategory = "trigger" | "action" | "logic";

/**
 * Registered node plugin. Use `configSchema` to validate `node.config` before execute.
 */
export interface NodeDefinition<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> {
  type: string;
  label: string;
  description?: string;
  icon?: string;
  category?: NodeCategory;
  configSchema?: z.ZodType<TConfig>;
  /** Typical merged input shape (for docs / generated forms). */
  inputSchema?: z.ZodType<unknown>;
  /** Typical node output shape (for docs / validation hints). */
  outputSchema?: z.ZodType<unknown>;
  execute: (params: ExecuteParams<TConfig>) => Promise<unknown>;
}

/** Emitted once before a node runs and once after it finishes (success or failure). */
export interface NodeProgressEvent {
  phase: "start" | "complete";
  nodeId: string;
  nodeType: string;
  /** Present only when `phase === "complete"` */
  ok?: boolean;
  error?: string;
}

/** Options for {@link WorkflowEngine.execute} */
export interface ExecuteOptions {
  executionId?: string;
  variables?: Record<string, unknown>;
  logger?: WorkflowLogger;
  signal?: AbortSignal;
  retries?: RetryPolicy;
  /** Stop the workflow on first node failure, or continue with structured error output */
  onNodeError?: "stop" | "continue";
  /** Called when each node begins and when it completes (including config validation failure). */
  onNodeProgress?: (event: NodeProgressEvent) => void;
}

/** Result of a finished workflow run */
export interface WorkflowExecuteResult {
  status: "completed" | "failed" | "partial";
  executionId: string;
  workflowId: string;
  /** Successful output per node id (includes failure placeholders when continuing) */
  outputs: Record<string, unknown>;
  errors: Record<string, string>;
  startedAt: string;
  finishedAt: string;
}
