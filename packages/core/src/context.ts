import { randomUUID } from "node:crypto";
import type { WorkflowExecutionContext, WorkflowLogger } from "./node.types.js";
import { createConsoleLogger } from "./logger.js";

export function createExecutionContext(options: {
  workflowId: string;
  workflowVersion?: number;
  executionId?: string;
  variables?: Record<string, unknown>;
  logger?: WorkflowLogger;
  signal?: AbortSignal;
}): WorkflowExecutionContext {
  const executionId = options.executionId ?? randomUUID();
  const logger =
    options.logger?.child({ executionId }) ??
    createConsoleLogger({ executionId, workflowId: options.workflowId });

  return {
    executionId,
    workflowId: options.workflowId,
    workflowVersion: options.workflowVersion,
    variables: { ...options.variables },
    logger,
    signal: options.signal,
  };
}
