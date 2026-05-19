import type { AgentToolDispatch, WorkflowLogger } from "@wfengine/core";
import type { AgentToolRef } from "../schemas.js";
import { formatAgentOrchestrationFailure } from "./agent-failure.js";
import {
  openAiChatCompletion,
  resolveLlmConfig,
  type LlmNodeConfig,
  type ChatMessage,
} from "./openai-chat.js";
import { runOpenAiToolLoop } from "./openai-tool-loop.js";
import { upstreamToJsonText } from "./upstream-payload.js";
import type { ResolvedAgentPersona } from "./resolve-agent-library.js";
import { shouldRequireToolsFirstCompletion } from "./multi-agent-tool-binding.js";
import {
  ToolLoopDebugLogger,
  summarizeMessages,
  truncateLargePayload,
} from "./tool-loop-debug.js";

type Persona = ResolvedAgentPersona;

/** Round-robin multi-agent turns (AutoGen-like UX without embedding Python). */
export async function runOrchestratedOpenAiMultiAgent(opts: {
  teamName?: string | undefined;
  agents: Persona[];
  model: string;
  temperature: number;
  timeoutMs: number;
  taskInstructions?: string | undefined;
  openAi: LlmNodeConfig;
  upstream: Record<string, unknown>;
  logger: WorkflowLogger;
  maxTurns: number;
  tools?: readonly AgentToolRef[] | undefined;
  agentToolDispatch?: AgentToolDispatch | undefined;
  variables?: Record<string, unknown> | undefined;
  forceToolsFirstCompletionOnTurnIndices?: readonly number[] | undefined;
  multiAgentToolBinding?:
    | "openai_tools_auto"
    | "pipeline_last_turn_tools_required";
  /** Execution context for structured log correlation. */
  executionContext?: {
    executionId?: string;
    workflowId?: string;
    nodeId?: string;
  } | undefined;
}): Promise<{
  transcript: { agent: string; content: string }[];
  finalAnswer: string;
}> {
  const llm = resolveLlmConfig({ ...opts.openAi, model: opts.model });
  const { provider, baseUrl, apiKey, model } = llm;

  // ── Debug logger ──────────────────────────────────────────────────────────
  const dbg = new ToolLoopDebugLogger(opts.logger, {
    executionId: opts.executionContext?.executionId,
    workflowId: opts.executionContext?.workflowId,
    nodeId: opts.executionContext?.nodeId,
    agentName: opts.teamName ?? "multi-agent-team",
    model,
    provider,
  });

  if (!apiKey) {
    throw formatAgentOrchestrationFailure({
      nodeType: "autogen.multi-agent",
      phase: "openai_setup",
      underlyingMessage:
        `autogen.multi-agent: ${provider} provider selected but no API key is configured. For OpenAI set openAiApiKey, WFENGINE_OPENAI_API_KEY, or OPENAI_API_KEY. For Ollama the runtime normally uses the dummy key "ollama".`,
    });
  }

  dbg.info("autogen.multi-agent: orchestration start", {
    teamName: opts.teamName,
    agentCount: opts.agents.length,
    agentNames: opts.agents.map((a) => a.name),
    maxTurns: opts.maxTurns,
    toolCount: opts.tools?.length ?? 0,
    model,
    provider,
    baseUrl,
    usedLegacyOllamaFallback: llm.usedLegacyOllamaFallback,
    timeoutMs: opts.timeoutMs,
    multiAgentToolBinding: opts.multiAgentToolBinding ?? "openai_tools_auto",
  });

  if (provider === "ollama" && opts.tools?.length) {
    dbg.warn("autogen.multi-agent: Ollama selected with tools", {
      baseUrl,
      model,
      message:
        "Many local models do not reliably emit OpenAI-compatible tool_calls; a linear workflow is usually more reliable for Ollama.",
    });
  }

  const upstreamText = upstreamToJsonText(opts.upstream);
  const task =
    (opts.taskInstructions?.trim() ?? "").length > 0
      ? `\n\nTask:\n${opts.taskInstructions!.trim()}`
      : "";

  const binding = opts.multiAgentToolBinding ?? "openai_tools_auto";
  if (
    binding === "pipeline_last_turn_tools_required" &&
    opts.maxTurns !== opts.agents.length
  ) {
    dbg.warn(
      "autogen.multi-agent: pipeline_last_turn_tools_required only applies when maxTurns equals the number of agents",
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

  const orchestrationStartedAt = Date.now();
  const n = opts.agents.length;

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const agent = opts.agents[turn % n]!;
    const elapsed = Date.now() - orchestrationStartedAt;
    const remaining = Math.max(5_000, opts.timeoutMs - elapsed);

    messages.push({
      role: "user",
      content: `Turn for **${agent.name}**: ${agent.systemPrompt}`,
    });

    const forceTools = shouldRequireToolsFirstCompletion({
      turn,
      maxTurns: opts.maxTurns,
      agentsCount: opts.agents.length,
      binding,
      explicitIndices: opts.forceToolsFirstCompletionOnTurnIndices,
    });

    // ── AGENT TURN START ──────────────────────────────────────────────────
    dbg.info("autogen.multi-agent: ===== AGENT TURN START =====", {
      agent: agent.name,
      turn,
      turnLabel: `${turn + 1} of ${opts.maxTurns}`,
      roundRobinIndex: turn % n,
      elapsedMs: elapsed,
      remainingMs: remaining,
      forceToolsFirstCompletion: forceTools,
      hasTools: Boolean(opts.tools?.length),
      toolCount: opts.tools?.length ?? 0,
      messageCount: messages.length,
      messageSummary: summarizeMessages(
        messages as Parameters<typeof summarizeMessages>[0],
        2,
      ),
    });

    const turnStartedAt = Date.now();

    try {
      const text =
        opts.tools?.length && opts.tools.length > 0
          ? await runOpenAiToolLoop({
              provider,
              baseUrl,
              apiKey,
              model,
              temperature: opts.temperature,
              timeoutMs: remaining,
              messages: [...messages],
              tools: [...opts.tools],
              dispatch: opts.agentToolDispatch,
              variables: opts.variables ?? {},
              openAiConfig: {
                llmProvider: opts.openAi.llmProvider,
                llmProviderWasExplicit: opts.openAi.llmProviderWasExplicit,
                openAiBaseUrl: opts.openAi.openAiBaseUrl,
                openAiApiKey: opts.openAi.openAiApiKey,
                ollamaBaseUrl: opts.openAi.ollamaBaseUrl,
              },
              maxIterations: 12,
              initialToolChoice:
                forceTools && opts.tools.length > 0 ? "required" : "auto",
              logger: opts.logger,
              executionContext: {
                executionId: opts.executionContext?.executionId,
                workflowId: opts.executionContext?.workflowId,
                nodeId: opts.executionContext?.nodeId,
                agentName: agent.name,
              },
            })
          : await openAiChatCompletion({
              provider,
              baseUrl,
              apiKey,
              model,
              messages: [...messages],
              temperature: opts.temperature,
              timeoutMs: remaining,
            });

      const turnDurationMs = Date.now() - turnStartedAt;

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

      // ── AGENT TURN END ──────────────────────────────────────────────────
      dbg.info("autogen.multi-agent: ===== AGENT TURN END =====", {
        agent: agent.name,
        turn,
        turnLabel: `${turn + 1} of ${opts.maxTurns}`,
        durationMs: turnDurationMs,
        outputLength: text.length,
        outputPreview: truncateLargePayload(text, 300),
        transcriptLength: transcript.length,
      });
    } catch (raw) {
      const underlyingMessage =
        raw instanceof Error ? raw.message : String(raw);
      const underlyingStack =
        raw instanceof Error ? raw.stack : undefined;
      const turnDurationMs = Date.now() - turnStartedAt;

      dbg.error("autogen.multi-agent: ===== AGENT TURN FAILED =====", {
        agent: agent.name,
        turn,
        turnLabel: `${turn + 1} of ${opts.maxTurns}`,
        durationMs: turnDurationMs,
        error: underlyingMessage,
        stack: underlyingStack,
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

  dbg.info("autogen.multi-agent: orchestration complete", {
    totalTurns: opts.maxTurns,
    transcriptLength: transcript.length,
    totalDurationMs: Date.now() - orchestrationStartedAt,
    finalAnswerLength: finalAnswer.length,
    finalAnswerPreview: truncateLargePayload(finalAnswer, 300),
  });

  return { transcript, finalAnswer };
}
