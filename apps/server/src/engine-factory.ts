import { WorkflowEngine } from "@wfengine/core";
import { registerBuiltinNodes } from "@wfengine/nodes-base";
import { registerAgentNodes } from "@wfengine/nodes-agents";

/** Shared engine configuration for API and worker processes */
export function createServerEngine(): WorkflowEngine {
  const engine = new WorkflowEngine();
  registerBuiltinNodes(engine);
  registerAgentNodes(engine);
  return engine;
}
