import { parseWorkflow, type WorkflowDefinition } from "@wfengine/shared";

/**
 * Normalizes all shapes accepted by {@link WorkflowEngine.execute} into a validated definition.
 * Mirrors prior inline logic exactly (string JSON vs object vs unknown).
 */
export function parseWorkflowFromEngineInput(
  workflowInput: WorkflowDefinition | string | unknown,
): WorkflowDefinition {
  if (typeof workflowInput === "string") {
    return parseWorkflow(JSON.parse(workflowInput) as unknown);
  }
  if (typeof workflowInput === "object" && workflowInput !== null) {
    return parseWorkflow(workflowInput);
  }
  return parseWorkflow(workflowInput);
}
