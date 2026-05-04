import type { AgentToolDispatch, WorkflowLogger } from "@wfengine/core";
import type { AgentToolRef } from "../schemas.js";
import { formatAgentOrchestrationFailure } from "./agent-failure.js";
import { openAiChatCompletion, resolveOpenAiFromEnv, type ChatMessage } from "./openai-chat.js";
import { runOpenAiToolLoop } from "./openai-tool-loop.js";
import { upstreamToJsonText } from "./upstream-payload.js";
import type { ResolvedAgentPersona } from "./resolve-agent-library.js";
import { shouldRequireToolsFirstCompletion } from "./multi-agent-tool-binding.js";

type Persona = ResolvedAgentPersona;

/** Round-robin multi-agent turns (AutoGen-like UX without embedding Python). */
export async function runOrchestratedOpenAiMultiAgent(opts: {
  teamName?: string | undefined;
  agents: Persona[];
  model: string;
  temperature: number;
  timeoutMs: number;
  taskInstructions?: string | undefined;
  openAi: { openAiBaseUrl?: string; openAiApiKey?: string };
  upstream: Record<string, unknown>;
  logger: WorkflowLogger;
  maxTurns: number;
  /** When set, each turn may invoke OpenAI tool calls (shared tool list for the team). */
  tools?: readonly AgentToolRef[] | undefined;
  agentToolDispatch?: AgentToolDispatch | undefined;
  /** Execution variables (e.g. `agentLibrary` for `library_agent` tools) */
  variables?: Record<string, unknown> | undefined;
  /** Turn indices (0-based) where the first completion uses `tool_choice: required` */
  forceToolsFirstCompletionOnTurnIndices?: readonly number[] | undefined;
  /** `multiAgentToolBinding` from the multi-agent node config */
  multiAgentToolBinding?:
    | "openai_tools_auto"
    | "pipeline_last_turn_tools_required";
}): Promise<{
  transcript: { agent: string; content: string }[];
  finalAnswer: string;
}> {
  const { baseUrl, apiKey } = resolveOpenAiFromEnv(opts.openAi);
  if (!apiKey) {
    throw formatAgentOrchestrationFailure({
      nodeType: "autogen.multi-agent",
      phase: "openai_setup",
      underlyingMessage:
        "autogen.multi-agent: set WFENGINE_OPENAI_API_KEY or OPENAI_API_KEY on the runner, or openAiApiKey on the node",
    });
  }

  const upstreamText = upstreamToJsonText(opts.upstream);
  const task =
    (opts.taskInstructions?.trim() ?? "").length > 0
      ? `\n\nTask:\n${opts.taskInstructions!.trim()}`
      : "";

  const binding =
    opts.multiAgentToolBinding ?? "openai_tools_auto";
  if (
    binding === "pipeline_last_turn_tools_required" &&
    opts.maxTurns !== opts.agents.length
  ) {
    opts.logger.warn(
      "autogen.multi-agent: pipeline_last_turn_tools_required only applies when maxTurns equals the number of agents (one turn per persona); otherwise no turn gets tool_choice required",
      {
        maxTurns: opts.maxTurns,
        agentsCount: opts.agents.length,
      },
    );
  }

  const transcript: { agent: string; content: string }[] = [];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Multi-agent discussion: respond only when asked for your agent turn.",
    },
    {
      role: "user",
      content: `Team ${opts.teamName ?? "workflow"}. Context:\n${upstreamText}${task}`,
    },
  ];

  const started = Date.now();
  const n = opts.agents.length;
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const agent = opts.agents[turn % n]!;
    const elapsed = Date.now() - started;
    const remaining = Math.max(5_000, opts.timeoutMs - elapsed);
    messages.push({
      role: "user",
      content: `Turn for **${agent.name}**: ${agent.systemPrompt}`,
    });
    opts.logger.info("autogen.multi-agent: turn starting", {
      agent: agent.name,
      turn,
      turnLabel: `${turn + 1} of ${opts.maxTurns}`,
      roundRobinIndex: turn % n,
    });
    try {
      const forceTools = shouldRequireToolsFirstCompletion({
        turn,
        maxTurns: opts.maxTurns,
        agentsCount: opts.agents.length,
        binding,
        explicitIndices: opts.forceToolsFirstCompletionOnTurnIndices,
      });
      const text =
        opts.tools?.length && opts.tools.length > 0
          ? await runOpenAiToolLoop({
              baseUrl,
              apiKey,
              model: opts.model,
              temperature: opts.temperature,
              timeoutMs: remaining,
              messages: [...messages],
              tools: [...opts.tools],
              dispatch: opts.agentToolDispatch,
              variables: opts.variables ?? {},
              openAiConfig: {
                openAiBaseUrl: opts.openAi.openAiBaseUrl,
                openAiApiKey: opts.openAi.openAiApiKey,
              },
              maxIterations: 12,
              initialToolChoice:
                forceTools && opts.tools.length > 0 ? "required" : "auto",
            })
          : await openAiChatCompletion({
              baseUrl,
              apiKey,
              model: opts.model,
              messages: [...messages],
              temperature: opts.temperature,
              timeoutMs: remaining,
            });
      if (
        (!opts.tools?.length || opts.tools.length === 0) &&
        text.trim().length === 0
      ) {
        throw formatAgentOrchestrationFailure({
          nodeType: "autogen.multi-agent",
          phase: "agent_turn",
          agentName: agent.name,
          turn,
          turnLabel: `${turn + 1} of ${opts.maxTurns}`,
          underlyingMessage:
            "Model returned empty text with no shared tools configured. Add workflow_node tools under Shared tools, or ensure each text-only turn produces non-empty output.",
        });
      }
      transcript.push({ agent: agent.name, content: text });
      messages.push({ role: "assistant", content: `[${agent.name}]: ${text}` });
      opts.logger.info("autogen.multi-agent: turn completed", {
        agent: agent.name,
        turn,
      });
    } catch (raw) {
      const underlyingMessage =
        raw instanceof Error ? raw.message : String(raw);
      const underlyingStack =
        raw instanceof Error ? raw.stack : undefined;
      opts.logger.error("autogen.multi-agent: turn failed", {
        agent: agent.name,
        turn,
        message: underlyingMessage,
      });
      throw formatAgentOrchestrationFailure({
        nodeType: "autogen.multi-agent",
        phase: "agent_turn",
        agentName: agent.name,
        turn,
        turnLabel: `${turn + 1} of ${opts.maxTurns}`,
        underlyingMessage,
        underlyingStack,
      });
    }
  }

  const finalAnswer = transcript[transcript.length - 1]?.content ?? "";
  return { transcript, finalAnswer };
}
