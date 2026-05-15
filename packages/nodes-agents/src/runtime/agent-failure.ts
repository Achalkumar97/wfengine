/** Embedded in Error.message as JSON for workflow Run inspector parsing */
export const WF_AGENT_FAILURE_KEY = "__wfengineAgentFailure" as const;

export type AgentOrchestrationFailurePayload = {
  [WF_AGENT_FAILURE_KEY]: true;
  nodeType: "autogen.multi-agent" | "mfa.agent-group" | "autogen.agent";
  phase:
    | "agent_turn"
    | "single_completion"
    | "openai_setup"
    | "python_autogen_bridge"
    | "workflow_tools";
  agentName?: string;
  /** 0-based round-robin index (autogen.multi-agent) */
  turn?: number;
  /** e.g. "3 of 6" */
  turnLabel?: string;
  /** 0-based sequential index (MFA) */
  stepIndex?: number;
  /** e.g. "2 of 5" */
  stepLabel?: string;
  underlyingMessage: string;
  underlyingStack?: string;
  timestamp: string;
};

export type AgentOrchestrationFailureInput = Omit<
  AgentOrchestrationFailurePayload,
  typeof WF_AGENT_FAILURE_KEY | "timestamp"
>;

export function formatAgentOrchestrationFailure(
  input: AgentOrchestrationFailureInput,
): Error {
  const body: AgentOrchestrationFailurePayload = {
    ...input,
    [WF_AGENT_FAILURE_KEY]: true,
    timestamp: new Date().toISOString(),
  };
  const msg = JSON.stringify(body, null, 2);
  const err = new Error(msg);
  err.name = "AgentOrchestrationError";
  return err;
}
