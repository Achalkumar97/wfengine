import { redactSecretsDeep } from "@wfengine/shared";
import type { WorkflowExecuteResult } from "./node.types.js";

/** Strip secrets from per-node outputs before returning results to clients or storing them. */
export function redactWorkflowExecuteResult(
  result: WorkflowExecuteResult,
): WorkflowExecuteResult {
  const outputs: Record<string, unknown> = {};
  for (const [nodeId, out] of Object.entries(result.outputs)) {
    outputs[nodeId] = redactSecretsDeep(out);
  }
  return { ...result, outputs };
}
