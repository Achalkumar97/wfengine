export class WorkflowValidationError extends Error {
  readonly name = "WorkflowValidationError";
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class UnknownNodeTypeError extends Error {
  readonly name = "UnknownNodeTypeError";
  constructor(
    public readonly nodeType: string,
    public readonly nodeId?: string,
  ) {
    super(`Unknown node type: ${nodeType}${nodeId ? ` (${nodeId})` : ""}`);
  }
}

export { CyclicWorkflowError } from "@wfengine/shared";
