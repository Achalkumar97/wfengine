import type { AgentToolDispatch } from "@wfengine/core";
import type { AgentToolRef } from "../schemas.js";
import {
  openAiChatCompletion,
  resolveLlmConfig,
  type LlmNodeConfig,
  type LlmProvider,
  type ChatMessage,
} from "./openai-chat.js";

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type Msg =
  | ChatMessage
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function toolFnName(index: number): string {
  return `wfengine_fn_${index}`;
}

/** Maps indexed OpenAI function names back to tool refs */
export function buildToolOpenAiSpecs(
  tools: AgentToolRef[],
): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return tools.map((ref, i) => {
    const name = toolFnName(i);
    if (ref.kind === "workflow_node") {
      const desc =
        ref.description?.trim() ??
        `Execute workflow node "${ref.nodeId}" with merged upstream context (optional JSON args shape from model).`;
      return {
        type: "function" as const,
        function: {
          name,
          description: desc,
          parameters: {
            type: "object",
            /** OpenAI requires `properties` on object schemas; args are free-form. */
            properties: {},
            description:
              "Merged into the target node's input alongside upstream workflow payload.",
            additionalProperties: true,
          },
        },
      };
    }
    const desc =
      ref.description?.trim() ??
      `Run reusable agent persona (${ref.agentId}) as a sub-call; optional JSON args passed as payload.`;
    return {
      type: "function" as const,
      function: {
        name,
        description: desc,
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: true,
        },
      },
    };
  });
}

type LibraryEntryShape = {
  id: string;
  name: string;
  systemPrompt: string;
  model?: string | undefined;
};

function findLibraryEntry(
  variables: Record<string, unknown>,
  agentId: string,
): LibraryEntryShape | undefined {
  const raw = variables.agentLibrary;
  if (!raw || typeof raw !== "object") return undefined;
  const agents = (raw as { agents?: unknown }).agents;
  if (!Array.isArray(agents)) return undefined;
  for (const a of agents) {
    if (
      a &&
      typeof a === "object" &&
      !Array.isArray(a) &&
      (a as { id?: string }).id === agentId
    ) {
      const o = a as LibraryEntryShape;
      if (typeof o.systemPrompt === "string" && o.systemPrompt.length > 0) {
        return o;
      }
    }
  }
  return undefined;
}

export async function runOpenAiToolLoop(opts: {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  /** Extra budget per HTTP round-trip inside the loop */
  loopRoundBudgetMs?: number;
  /**
   * Either provide `messages` (multi-agent turns) or both `systemPrompt` and `userContent`.
   */
  messages?: Msg[];
  systemPrompt?: string;
  userContent?: string;
  tools: AgentToolRef[];
  dispatch: AgentToolDispatch | undefined;
  variables: Record<string, unknown>;
  openAiConfig: LlmNodeConfig;
  maxIterations?: number;
  /**
   * First HTTP completion only: `"required"` maps to OpenAI `tool_choice: required` so the model must call
   * at least one tool (then the loop uses `auto`). Use with multi-agent “executor” turns.
   */
  initialToolChoice?: "auto" | "required";
}): Promise<string> {
  const maxIterations = Math.min(Math.max(opts.maxIterations ?? 16, 1), 32);
  const specs = buildToolOpenAiSpecs(opts.tools);
  const messages: Msg[] =
    opts.messages && opts.messages.length > 0
      ? [...opts.messages]
      : opts.systemPrompt !== undefined && opts.userContent !== undefined
        ? [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: opts.userContent },
          ]
        : (() => {
            throw new Error(
              "runOpenAiToolLoop: pass `messages` or both `systemPrompt` and `userContent`",
            );
          })();

  const started = Date.now();
  /** True after at least one tool batch in this call completed without JSON `{ error: ... }`. Allows empty final assistant text after tools ran. */
  let anyToolRoundCompletedOk = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    const elapsed = Date.now() - started;
    const remaining = Math.max(5_000, opts.timeoutMs - elapsed);
    const roundBudget =
      opts.loopRoundBudgetMs ??
      Math.min(120_000, Math.max(15_000, remaining));

    const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), roundBudget);
    let textRaw: string;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          temperature: opts.temperature,
          tools: specs,
          tool_choice:
            iter === 0 && opts.initialToolChoice === "required"
              ? "required"
              : "auto",
        }),
        signal: ac.signal,
      });
      textRaw = await res.text();
      if (!res.ok) {
        throw new Error(
          `${opts.provider} tool-loop chat completion failed (${res.status}) at ${url}: ${textRaw.slice(0, 800)}`,
        );
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("tool-loop chat completion failed")
      ) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${opts.provider} tool-loop chat completion request failed at ${url}: ${message}`,
        { cause: err },
      );
    } finally {
      clearTimeout(timer);
    }

    const j = JSON.parse(textRaw) as {
      choices?: Array<{
        finish_reason?: string;
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: OpenAiToolCall[];
        };
      }>;
    };
    const choice = j.choices?.[0];
    const msg = choice?.message;
    const finish = choice?.finish_reason;

    if (!msg) {
      throw new Error("Model returned no message");
    }

    if (msg.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: msg.tool_calls,
      });

      let batchToolError: string | undefined;
      for (const call of msg.tool_calls) {
        const fn = call.function.name;
        const match = /^wfengine_fn_(\d+)$/.exec(fn);
        const idx = match ? Number.parseInt(match[1]!, 10) : -1;
        const ref = idx >= 0 ? opts.tools[idx] : undefined;
        let resultText: string;
        if (!ref) {
          resultText = JSON.stringify({
            error: `Unknown tool function: ${fn}`,
          });
        } else {
          let args: Record<string, unknown> = {};
          try {
            const raw = call.function.arguments?.trim() ?? "{}";
            const parsed = JSON.parse(raw) as unknown;
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              args = parsed as Record<string, unknown>;
            }
          } catch {
            args = { _raw: call.function.arguments };
          }
          try {
            if (ref.kind === "workflow_node") {
              if (!opts.dispatch) {
                resultText = JSON.stringify({
                  error:
                    "workflow_node tools require a full workflow run (no agentToolDispatch on this execute path)",
                });
              } else {
                const out = await opts.dispatch.executeWorkflowNode(
                  ref.nodeId,
                  args,
                );
                resultText =
                  typeof out === "string"
                    ? out
                    : JSON.stringify(out, null, 2);
              }
            } else {
              const entry = findLibraryEntry(opts.variables, ref.agentId);
              if (!entry) {
                resultText = JSON.stringify({
                  error: `library_agent not found: ${ref.agentId}. Include "agentLibrary" in the run request (Studio does this when the library is non-empty).`,
                });
              } else {
                const subConfig = resolveLlmConfig({
                  ...opts.openAiConfig,
                  model: entry.model?.trim() || opts.model,
                });
                if (!subConfig.apiKey) {
                  resultText = JSON.stringify({
                    error: `No API key for ${subConfig.provider} library_agent sub-call`,
                  });
                } else {
                  const sub = await openAiChatCompletion({
                    provider: subConfig.provider,
                    baseUrl: subConfig.baseUrl,
                    apiKey: subConfig.apiKey,
                    model: subConfig.model,
                    messages: [
                      { role: "system", content: entry.systemPrompt },
                      {
                        role: "user",
                        content: `Tool payload:\n${JSON.stringify(args)}`,
                      },
                    ],
                    temperature: opts.temperature,
                    timeoutMs: Math.max(5_000, remaining - 2_000),
                  });
                  resultText = sub;
                }
              }
            }
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            resultText = JSON.stringify({ error: err });
          }
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultText,
        });

        try {
          const parsed = JSON.parse(resultText) as { error?: unknown };
          if (
            parsed &&
            typeof parsed === "object" &&
            parsed.error !== undefined &&
            parsed.error !== null
          ) {
            const em =
              typeof parsed.error === "string"
                ? parsed.error
                : JSON.stringify(parsed.error);
            if (em.trim().length > 0) {
              batchToolError = batchToolError ?? em;
            }
          }
        } catch {
          /* not JSON — OK */
        }
      }
      if (batchToolError) {
        throw new Error(batchToolError);
      }
      anyToolRoundCompletedOk = true;
      continue;
    }

    const c = msg.content;
    const textOut = typeof c === "string" ? c : "";
    if (textOut.trim().length > 0) {
      return textOut;
    }
    if (opts.tools.length > 0) {
      if (anyToolRoundCompletedOk) {
        return textOut;
      }
      throw new Error(
        "Model returned empty content without calling tools. For turns that must run workflow tools, the model must issue tool_calls; for text-only turns (no tools), provide non-empty text.",
      );
    }
    if (finish === "stop" || finish === "length") {
      return textOut;
    }
    throw new Error("Model returned empty content without tool calls");
  }

  throw new Error(
    `OpenAI tool loop exceeded max iterations (${maxIterations})`,
  );
}
