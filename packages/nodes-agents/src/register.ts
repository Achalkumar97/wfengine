import type { WorkflowEngine } from "@wfengine/core";
import { autogenAgentNode } from "./nodes/autogen-agent.js";
import { autogenMultiAgentNode } from "./nodes/autogen-multi-agent.js";
import { mfaAgentGroupNode } from "./nodes/mfa-agent-group.js";

/** Register MAF-style and AutoGen bridge nodes (OpenAI-compatible + optional Python). */
export function registerAgentNodes(engine: WorkflowEngine): void {
  engine.registerNodeReplace(mfaAgentGroupNode);
  engine.registerNodeReplace(autogenAgentNode);
  engine.registerNodeReplace(autogenMultiAgentNode);
}
