import type { WorkflowLogger } from "@wfengine/core";
import { z } from "zod";
import { MfaAgentGroupConfigSchema } from "../schemas.js";
import { formatAgentOrchestrationFailure } from "./agent-failure.js";
import {
  effectiveLlmModel,
  openAiChatCompletion,
  resolveOpenAiFromEnv,
  type ChatMessage,
} from "./openai-chat.js";
import { upstreamToJsonText } from "./upstream-payload.js";
import type { ResolvedAgentPersona } from "./resolve-agent-library.js";

type Persona = ResolvedAgentPersona;
type GroupCfg = Omit<z.infer<typeof MfaAgentGroupConfigSchema>, "agents"> & {
  agents: ResolvedAgentPersona[];
};

/** Models often wrap JSON in ```json fences despite "ONLY JSON" instructions. */
function stripMarkdownJsonFence(text: string): string {
  let s = text.trim();
  if (!s.startsWith("```")) return s;
  s = s.replace(/^```(?:json)?\s*\r?\n?/i, "");
  const fenceEnd = s.lastIndexOf("```");
  if (fenceEnd !== -1) {
    s = s.slice(0, fenceEnd);
  }
  return s.trim();
}

function parseSingleCompletionJson(raw: string): Record<string, unknown> | null {
  const attempts = [raw.trim(), stripMarkdownJsonFence(raw)];
  for (const chunk of attempts) {
    try {
      return JSON.parse(chunk) as Record<string, unknown>;
    } catch {
      /* try next */
    }
  }
  const stripped = stripMarkdownJsonFence(raw);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(stripped.slice(start, end + 1)) as Record<
        string,
        unknown
      >;
    } catch {
      return null;
    }
  }
  return null;
}

export async function runMfaAgentGroupOrchestration(opts: {
  config: GroupCfg;
  upstream: Record<string, unknown>;
  logger: WorkflowLogger;
}): Promise<{
  transcript: { agent: string; content: string }[];
  finalAnswer: string;
  structured?: Record<string, unknown>;
}> {
  const resolved = resolveOpenAiFromEnv(opts.config);
  const { baseUrl, apiKey, usedOllamaEnvFallback } = resolved;
  const model = effectiveLlmModel(opts.config.model, usedOllamaEnvFallback);

  if (!apiKey) {
    throw formatAgentOrchestrationFailure({
      nodeType: "mfa.agent-group",
      phase: "openai_setup",
      underlyingMessage:
        "mfa.agent-group: set WFENGINE_OPENAI_API_KEY or OPENAI_API_KEY or openAiApiKey on the node, or OLLAMA_BASE_URL / WFENGINE_OLLAMA_BASE_URL for Ollama fallback",
    });
  }

  if (usedOllamaEnvFallback) {
    opts.logger.info("mfa.agent-group: Ollama env fallback", { baseUrl, model });
  }

  const upstreamText = upstreamToJsonText(opts.upstream);
  const task =
    (opts.config.taskInstructions?.trim() ?? "").length > 0
      ? `\n\nTask / constraints:\n${opts.config.taskInstructions!.trim()}`
      : "";

  if (opts.config.orchestrationMode === "single_completion") {
    const system = buildSingleShotSystemPrompt(opts.config.agents);
    const user = `Workflow payload (JSON):\n${upstreamText}${task}\n\nReturn ONLY valid JSON with keys: transcript (array of {agent, content}), finalAnswer (string), structured (optional object).`;
    let raw: string;
    try {
      opts.logger.info("mfa.agent-group: single_completion request", {
        model,
      });
      raw = await openAiChatCompletion({
        baseUrl,
        apiKey,
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: opts.config.temperature ?? 0.3,
        timeoutMs: opts.config.timeoutMs ?? 180_000,
      });
    } catch (rawErr) {
      const underlyingMessage =
        rawErr instanceof Error ? rawErr.message : String(rawErr);
      const underlyingStack =
        rawErr instanceof Error ? rawErr.stack : undefined;
      opts.logger.error("mfa.agent-group: single_completion failed", {
        message: underlyingMessage,
      });
      throw formatAgentOrchestrationFailure({
        nodeType: "mfa.agent-group",
        phase: "single_completion",
        underlyingMessage,
        underlyingStack,
      });
    }
    const structured = parseSingleCompletionJson(raw);
    if (!structured) {
      opts.logger.info(
        "mfa.agent-group: single_completion JSON parse failed — returning raw text",
      );
      return {
        transcript: [{ agent: "model", content: raw }],
        finalAnswer: raw,
      };
    }
    const tr = structured.transcript;
    const transcript: { agent: string; content: string }[] = [];
    if (Array.isArray(tr)) {
      for (const row of tr) {
        if (!row || typeof row !== "object") continue;
        const o = row as Record<string, unknown>;
        const agent = typeof o.agent === "string" ? o.agent : "?";
        const content = typeof o.content === "string" ? o.content : "";
        transcript.push({ agent, content });
      }
    }
    const fa =
      typeof structured.finalAnswer === "string"
        ? structured.finalAnswer
        : transcript[transcript.length - 1]?.content ?? raw;
    return { transcript, finalAnswer: fa, structured };
  }

  /* sequential multi-turn */
  const transcript: { agent: string; content: string }[] = [];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are part of a multi-agent workflow. Each user message starts an agent turn; reply only as that agent.",
    },
    {
      role: "user",
      content: `Shared workflow context:\n${upstreamText}${task}`,
    },
  ];

  let remaining = opts.config.timeoutMs ?? 180_000;
  const started = Date.now();

  const agentList = opts.config.agents as Persona[];
  for (let stepIndex = 0; stepIndex < agentList.length; stepIndex++) {
    const agent = agentList[stepIndex]!;
    const elapsed = Date.now() - started;
    remaining = Math.max(5_000, (opts.config.timeoutMs ?? 180_000) - elapsed);
    messages.push({
      role: "user",
      content: `Agent turn **${agent.name}**${agent.role ? ` (${agent.role})` : ""}:\n${agent.systemPrompt}\n\nProduce your message for the workflow.`,
    });
    opts.logger.info("mfa.agent-group: agent turn starting", {
      agent: agent.name,
      stepIndex,
      stepLabel: `${stepIndex + 1} of ${agentList.length}`,
    });
    try {
      const text = await openAiChatCompletion({
        baseUrl,
        apiKey,
        model,
        messages: [...messages],
        temperature: opts.config.temperature ?? 0.3,
        timeoutMs: remaining,
      });
      transcript.push({ agent: agent.name, content: text });
      messages.push({ role: "assistant", content: `[${agent.name}]: ${text}` });
      opts.logger.info("mfa.agent-group: agent turn completed", {
        agent: agent.name,
        stepIndex,
      });
    } catch (rawErr) {
      const underlyingMessage =
        rawErr instanceof Error ? rawErr.message : String(rawErr);
      const underlyingStack =
        rawErr instanceof Error ? rawErr.stack : undefined;
      opts.logger.error("mfa.agent-group: agent turn failed", {
        agent: agent.name,
        stepIndex,
        message: underlyingMessage,
      });
      throw formatAgentOrchestrationFailure({
        nodeType: "mfa.agent-group",
        phase: "agent_turn",
        agentName: agent.name,
        stepIndex,
        stepLabel: `${stepIndex + 1} of ${agentList.length}`,
        underlyingMessage,
        underlyingStack,
      });
    }
  }

  const finalAnswer =
    transcript[transcript.length - 1]?.content ??
    "";
  return { transcript, finalAnswer };
}

function buildSingleShotSystemPrompt(agents: Persona[]): string {
  const lines = agents.map(
    (a) =>
      `- **${a.name}**${a.role ? ` (${a.role})` : ""}: ${a.systemPrompt.slice(0, 2_000)}`,
  );
  return [
    "Simulate a Microsoft Agent Framework–style agent group: combine perspectives into one JSON result.",
    "Agents:",
    ...lines,
  ].join("\n");
}
