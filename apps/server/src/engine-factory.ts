import { WorkflowEngine } from "@wfengine/core";
import { registerBuiltinNodes } from "@wfengine/nodes-base";

/** Shared engine configuration for API and worker processes */
export function createServerEngine(): WorkflowEngine {
  const engine = new WorkflowEngine();
  registerBuiltinNodes(engine);
  return engine;
}
