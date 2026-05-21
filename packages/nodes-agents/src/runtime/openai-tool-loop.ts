/**
 * openai-tool-loop.ts
 *
 * Production-grade OpenAI function-calling loop with deep debugging instrumentation.
 *
 * Every significant boundary emits a structured log entry:
 *   ===== BEFORE OPENAI CALL =====
 *   ===== AFTER OPENAI CALL =====
 *   ===== TOOL EXECUTION START =====
 *   ===== TOOL EXECUTION END =====
 *   ===== SENDING TOOL RESULT BACK TO OPENAI =====
 *   ===== TOOL LOOP ITERATION =====
 *   ===== STREAM START / END =====
 *   ===== TIMEOUT =====
 *   ===== PROTOCOL VALIDATION =====
 *
 * All entries carry: executionId, workflowId, nodeId, agentName, turn,
 * model, provider, timestamp, duration where applicable.
 */
import type { AgentToolDispatch, WorkflowLogger } from "@wfengine/core";
import type { AgentToolRef } from "../schemas.js";
import {
  openAiChatCompletion,
  resolveLlmConfig,
  type LlmNodeConfig,
  type LlmProvider,
  type ChatMessage,
} from "./openai-chat.js";
import {
  ToolLoopDebugLogger,
  buildFallbackLogger,
  safeJsonStringify,
  truncateLargePayload,
  summarizeMessages,
  validateToolProtocol,
  TOOL_RESULT_WARN_LIMIT,
  TOOL_RESULT_HARD_LIMIT,
} from "./tool-loop-debug.js";

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/**
 * Safely truncate a tool result to TOOL_RESULT_HARD_LIMIT before injecting
 * into the messages array. Logs a warning if truncation occurs.
 */
function capToolResult(
  result: string,
  dbg: ToolLoopDebugLogger,
  toolName: string,
  turn: number,
): string {
  if (result.length <= TOOL_RESULT_HARD_LIMIT) return result;
  const truncated = `${result.slice(0, TOOL_RESULT_HARD_LIMIT)}\n…[TRUNCATED: original ${result.length} chars, hard limit ${TOOL_RESULT_HARD_LIMIT}]`;
  dbg.warn("===== TOOL RESULT TRUNCATED =====", {
    turn,
    toolName,
    originalChars: result.length,
    truncatedChars: truncated.length,
    hardLimit: TOOL_RESULT_HARD_LIMIT,
    note: "Tool result exceeded hard limit and was truncated before sending to OpenAI",
  });
  return truncated;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Deep-instrumented OpenAI tool-calling loop.
 *
 * Logs every boundary with structured context so you can trace exactly:
 *   - where execution hangs (timeout logs show AbortController trigger)
 *   - what messages are sent to OpenAI (BEFORE OPENAI CALL)
 *   - what tool results are returned (TOOL EXECUTION END)
 *   - whether tool_call_id mapping is correct (PROTOCOL VALIDATION)
 *   - whether tool continuation requests are malformed (SENDING TOOL RESULT)
 *   - whether the loop becomes recursive/stuck (TOOL LOOP ITERATION counter)
 *   - oversized payloads (TOOL RESULT TRUNCATED)
 */
export async function runOpenAiToolLoop(opts: {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  loopRoundBudgetMs?: number;
  messages?: Msg[];
  systemPrompt?: string;
  userContent?: string;
  tools: AgentToolRef[];
  dispatch: AgentToolDispatch | undefined;
  variables: Record<string, unknown>;
  openAiConfig: LlmNodeConfig;
  maxIterations?: number;
  initialToolChoice?: "auto" | "required";
  logger?: WorkflowLogger | undefined;
  executionContext?: {
    executionId?: string;
    workflowId?: string;
    nodeId?: string;
    agentName?: string;
  } | undefined;
  /** Forwarded AbortSignal — aborts in-flight fetches and skips pending tools. */
  signal?: AbortSignal | undefined;
}): Promise<string> {
  const maxIterations = Math.min(Math.max(opts.maxIterations ?? 16, 1), 32);
  const specs = buildToolOpenAiSpecs(opts.tools);

  // ── Build initial messages ────────────────────────────────────────────────
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

  // ── Set up debug logger ───────────────────────────────────────────────────
  const ctx = opts.executionContext ?? {};
  const baseLogger: WorkflowLogger = opts.logger ?? buildFallbackLogger();
  const dbg = new ToolLoopDebugLogger(baseLogger, {
    executionId: ctx.executionId,
    workflowId: ctx.workflowId,
    nodeId: ctx.nodeId,
    agentName: ctx.agentName,
    model: opts.model,
    provider: opts.provider,
  });

  const loopStartedAt = Date.now();

  // ── STREAM START ──────────────────────────────────────────────────────────
  dbg.info("===== STREAM START =====", {
    maxIterations,
    toolCount: opts.tools.length,
    toolNames: opts.tools.map((t) =>
      t.kind === "workflow_node" ? `workflow_node:${t.nodeId}` : `library_agent:${t.agentId}`,
    ),
    messageCount: messages.length,
    timeoutMs: opts.timeoutMs,
    loopRoundBudgetMs: opts.loopRoundBudgetMs,
    baseUrl: opts.baseUrl,
    initialToolChoice: opts.initialToolChoice ?? "auto",
    messageSummary: summarizeMessages(messages as Parameters<typeof summarizeMessages>[0], 2),
  });

  let anyToolRoundCompletedOk = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    // ── Abort check (top of iteration) ─────────────────────────────────────
    if (opts.signal?.aborted) {
      dbg.info("===== ABORT SIGNAL — stopping tool loop =====", { turn: iter });
      throw new DOMException("Aborted", "AbortError");
    }
    // ──────────────────────────────────────────────────────────────────────
    const elapsed = Date.now() - loopStartedAt;
    const remaining = Math.max(5_000, opts.timeoutMs - elapsed);
    const roundBudget =
      opts.loopRoundBudgetMs ??
      Math.min(120_000, Math.max(15_000, remaining));

    // ── TOOL LOOP ITERATION ───────────────────────────────────────────────
    dbg.info("===== TOOL LOOP ITERATION =====", {
      turn: iter,
      totalIterations: maxIterations,
      elapsedMs: elapsed,
      remainingMs: remaining,
      roundBudgetMs: roundBudget,
      messageCount: messages.length,
      anyToolRoundCompletedOk,
      messageOrder: summarizeMessages(
        messages as Parameters<typeof summarizeMessages>[0],
        0,
      ).messageOrder,
    });

    const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const toolChoice =
      iter === 0 && opts.initialToolChoice === "required" ? "required" : "auto";

    // ── BEFORE OPENAI CALL ────────────────────────────────────────────────
    const msgSummary = summarizeMessages(
      messages as Parameters<typeof summarizeMessages>[0],
      3,
    );
    const lastMsg = messages[messages.length - 1];

    dbg.info("===== BEFORE OPENAI CALL =====", {
      turn: iter,
      url,
      toolChoice,
      toolsEnabled: specs.length > 0,
      toolCount: specs.length,
      toolSpecs: specs.map((s) => s.function.name),
      messageCount: messages.length,
      roleCounts: msgSummary.roleCounts,
      messageOrder: msgSummary.messageOrder,
      lastMessage: {
        role: lastMsg ? (lastMsg as { role?: string }).role : null,
        contentPreview: lastMsg
          ? truncateLargePayload(
              (lastMsg as { content?: unknown }).content ?? "",
              300,
            )
          : null,
        hasToolCalls: Boolean(
          (lastMsg as { tool_calls?: unknown[] })?.tool_calls?.length,
        ),
        toolCallId: (lastMsg as { tool_call_id?: string })?.tool_call_id,
      },
      last3Messages: msgSummary.lastMessages,
      roundBudgetMs: roundBudget,
      remainingMs: remaining,
    });

    // ── AbortController + timeout ──────────────────────────────────────
    const ac = new AbortController();
    let timedOut = false;
    // Link parent cancellation signal so Stop aborts the in-flight fetch.
    const onParentAbort = () => ac.abort();
    opts.signal?.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      // ── TIMEOUT ────────────────────────────────────────────────────────
      dbg.error("===== TIMEOUT =====", {
        turn: iter,
        roundBudgetMs: roundBudget,
        elapsedMs: Date.now() - loopStartedAt,
        operation: "OpenAI chat completion",
        url,
        messageCount: messages.length,
        note: "AbortController.abort() triggered — connection will be killed",
      });
      ac.abort();
    }, roundBudget);

    const callStartedAt = Date.now();
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
          tool_choice: toolChoice,
        }),
        signal: ac.signal,
      });

      textRaw = await res.text();

      if (!res.ok) {
        const callDurationMs = Date.now() - callStartedAt;
        dbg.error("===== OPENAI HTTP ERROR =====", {
          turn: iter,
          httpStatus: res.status,
          httpStatusText: res.statusText,
          durationMs: callDurationMs,
          responsePreview: truncateLargePayload(textRaw, 800),
          url,
          timedOut,
        });
        throw new Error(
          `${opts.provider} tool-loop chat completion failed (${res.status}) at ${url}: ${textRaw.slice(0, 800)}`,
        );
      }
    } catch (err) {
      const callDurationMs = Date.now() - callStartedAt;
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || err.message.includes("aborted"));

      dbg.error("===== OPENAI CALL FAILED =====", {
        turn: iter,
        durationMs: callDurationMs,
        isAbort,
        timedOut,
        roundBudgetMs: roundBudget,
        error: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : "unknown",
        url,
        note: isAbort
          ? "Request was aborted — likely a timeout. Check roundBudgetMs vs actual OpenAI latency."
          : "Network or HTTP error",
      });

      if (
        err instanceof Error &&
        err.message.includes("tool-loop chat completion failed")
      ) {
        throw err;
      }
      // Propagate abort cleanly without re-wrapping.
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
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
      opts.signal?.removeEventListener("abort", onParentAbort);
    }

    // ── Parse response ────────────────────────────────────────────────────
    let j: {
      choices?: Array<{
        finish_reason?: string;
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: OpenAiToolCall[];
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      error?: { message?: string; type?: string; code?: string };
    };

    try {
      j = JSON.parse(textRaw) as typeof j;
    } catch (parseErr) {
      dbg.error("===== RESPONSE PARSE FAILED =====", {
        turn: iter,
        rawPreview: truncateLargePayload(textRaw, 500),
        rawLength: textRaw.length,
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      throw new Error(
        `Failed to parse OpenAI response JSON at turn ${iter}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
    }

    const callDurationMs = Date.now() - callStartedAt;
    const choice = j.choices?.[0];
    const msg = choice?.message;
    const finish = choice?.finish_reason;
    const usage = j.usage;

    // ── AFTER OPENAI CALL ─────────────────────────────────────────────────
    dbg.info("===== AFTER OPENAI CALL =====", {
      turn: iter,
      durationMs: callDurationMs,
      finishReason: finish ?? null,
      hasToolCalls: Boolean(msg?.tool_calls?.length),
      toolCallCount: msg?.tool_calls?.length ?? 0,
      toolCallIds: msg?.tool_calls?.map((tc) => tc.id) ?? [],
      toolCallNames: msg?.tool_calls?.map((tc) => tc.function.name) ?? [],
      assistantContentPreview: truncateLargePayload(msg?.content ?? "", 300),
      assistantContentLength: typeof msg?.content === "string" ? msg.content.length : 0,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      streamCompleted: true,
      apiError: j.error ?? null,
    });

    // Check for API-level error in response body
    if (j.error) {
      dbg.error("===== OPENAI API ERROR IN RESPONSE =====", {
        turn: iter,
        apiError: j.error,
        note: "OpenAI returned HTTP 200 but with an error object in the body",
      });
      throw new Error(
        `OpenAI API error at turn ${iter}: ${j.error.message ?? safeJsonStringify(j.error)}`,
      );
    }

    if (!msg) {
      dbg.error("===== NO MESSAGE IN RESPONSE =====", {
        turn: iter,
        rawPreview: truncateLargePayload(textRaw, 400),
        choices: j.choices?.length ?? 0,
      });
      throw new Error("Model returned no message");
    }

    // ── Tool calls branch ─────────────────────────────────────────────────
    if (msg.tool_calls?.length) {
      // Push assistant message with tool_calls
      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: msg.tool_calls,
      });

      dbg.debug("===== ASSISTANT TOOL_CALLS PUSHED =====", {
        turn: iter,
        toolCallCount: msg.tool_calls.length,
        toolCallIds: msg.tool_calls.map((tc) => tc.id),
        toolCallNames: msg.tool_calls.map((tc) => tc.function.name),
        assistantContent: truncateLargePayload(msg.content ?? "", 200),
        messageCountAfterPush: messages.length,
      });

      let batchToolError: string | undefined;

      for (const call of msg.tool_calls) {
        // ── Pre-tool abort check ──────────────────────────────────────────
        // Prevents email/file-write tools from starting after user presses Stop.
        if (opts.signal?.aborted) {
          dbg.info("===== ABORT SIGNAL — skipping tool dispatch =====", {
            turn: iter,
            toolCallId: call.id,
            toolName: call.function.name,
          });
          throw new DOMException("Aborted", "AbortError");
        }
        // ────────────────────────────────────────────────────────────
        const fn = call.function.name;
        const match = /^wfengine_fn_(\d+)$/.exec(fn);
        const idx = match ? Number.parseInt(match[1]!, 10) : -1;
        const ref = idx >= 0 ? opts.tools[idx] : undefined;

        const toolName =
          ref?.kind === "workflow_node"
            ? `workflow_node:${ref.nodeId}`
            : ref?.kind === "library_agent"
              ? `library_agent:${ref.agentId}`
              : fn;

        // ── TOOL EXECUTION START ────────────────────────────────────────
        const toolStartedAt = Date.now();
        let parsedArgs: Record<string, unknown> = {};
        try {
          const rawArgs = call.function.arguments?.trim() ?? "{}";
          const parsed = JSON.parse(rawArgs) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            parsedArgs = parsed as Record<string, unknown>;
          }
        } catch {
          parsedArgs = { _raw: call.function.arguments };
        }

        const aliasMap: Record<string, string> = {
          slackText: "text",
          message: "text",
          content: "text",
          body: "text",
          htmlBody: "html",
          recipients: "to",
          recipient: "to",
          emailRecipients: "to",
          emailTo: "to",
          addresses: "to",
          email: "to",
          recipientAddress: "to",
          toAddress: "to",
          toAddresses: "to",
          title: "subject",
          topic: "subject",
          emailSubject: "subject",
        };

        const normalizedArgs: Record<string, unknown> = { ...parsedArgs };
        for (const [key, value] of Object.entries(parsedArgs)) {
          const canonical = aliasMap[key];
          if (canonical && normalizedArgs[canonical] === undefined) {
            normalizedArgs[canonical] = value;
          }
        }

        dbg.info("===== TOOL EXECUTION START =====", {
          turn: iter,
          toolCallId: call.id,
          toolName,
          toolFunctionName: fn,
          toolIndex: idx,
          toolKind: ref?.kind ?? "unknown",
          argsPreview: truncateLargePayload(normalizedArgs, 400),
          argsKeys: Object.keys(normalizedArgs),
          rawArgumentsLength: call.function.arguments?.length ?? 0,
          toolCallIdValid: Boolean(call.id && call.id.trim().length > 0),
        });

        let resultText: string = "";
        let validationFailed = false;

        // ── TOOL ARGUMENT PRE-VALIDATION ─────────────────────────────────────
        // Validate known fields before executing tools to prevent obvious API errors
        if (ref?.kind === "workflow_node") {
          // Required fields keyed by canonical workflow node type (wfType), plus
          // backward-compatible legacy hyphenated names.
          // Note: 'to' is optional for email.send since it can use config value as fallback
          const requiredFields: Record<string, string[]> = {
            "email.send": ["subject", "text"],
            "slack.send": ["text"],
            // legacy keys still supported
            "send-email": ["subject", "text"],
            "send-slack": ["text"],
          };

          const idParts = ref.nodeId.split("-");
          const base = idParts[0] ?? ref.nodeId;
          const legacy = idParts.length >= 2 ? `${idParts[0]}-${idParts[1]}` : base;
          const nodeType = base || legacy || ref.nodeId;
          const required = requiredFields[nodeType] || requiredFields[legacy] || [];

          for (const field of required) {
            const providedKeys = [
              field,
              ...Object.entries(aliasMap)
                .filter(([, canonical]) => canonical === field)
                .map(([alias]) => alias),
            ];
            const provided = providedKeys.some((key) =>
              normalizedArgs[key] !== undefined &&
              !(typeof normalizedArgs[key] === "string" && normalizedArgs[key].trim().length === 0),
            );

            if (!provided) {
              resultText = safeJsonStringify({
                error: `Tool execution blocked: missing required field '${field}' for node '${ref.nodeId}'. Provide '${field}' or a supported alias such as ${providedKeys.join(", ")}.`,
              });
              dbg.warn("===== TOOL ARGUMENT VALIDATION FAILED =====", {
                turn: iter,
                toolCallId: call.id,
                toolName,
                missingField: field,
                nodeType,
                requiredFields: required,
                providedArgs: Object.keys(normalizedArgs),
              });
              validationFailed = true;
              break;
            }

            const value = normalizedArgs[field];
            if (
              value === undefined ||
              (typeof value === "string" && value.trim().length === 0)
            ) {
              resultText = safeJsonStringify({
                error: `Tool execution blocked: required field '${field}' is empty for node '${ref.nodeId}'. Provide a non-empty '${field}' or a supported alias.`,
              });
              dbg.warn("===== TOOL ARGUMENT VALIDATION FAILED =====", {
                turn: iter,
                toolCallId: call.id,
                toolName,
                missingField: field,
                nodeType,
                requiredFields: required,
                providedArgs: Object.keys(normalizedArgs),
              });
              validationFailed = true;
              break;
            }
          }
        }

        if (!validationFailed && ref?.kind === "workflow_node") {
          parsedArgs = normalizedArgs;
        }

        if (validationFailed) {
          // Skip execution, resultText already set with error
        } else if (!ref) {
          resultText = safeJsonStringify({
            error: `Unknown tool function: ${fn}. Available: ${opts.tools.map((_, i) => toolFnName(i)).join(", ")}`,
          });
          dbg.warn("===== TOOL NOT FOUND =====", {
            turn: iter,
            toolCallId: call.id,
            functionName: fn,
            availableTools: opts.tools.map((_, i) => toolFnName(i)),
          });
        } else {
          try {
            if (ref.kind === "workflow_node") {
              if (!opts.dispatch) {
                resultText = safeJsonStringify({
                  error:
                    "workflow_node tools require a full workflow run (no agentToolDispatch on this execute path)",
                });
              } else {
                const out = await opts.dispatch.executeWorkflowNode(
                  ref.nodeId,
                  parsedArgs,
                );
                resultText =
                  typeof out === "string" ? out : safeJsonStringify(out, 2);
              }
            } else {
              // library_agent
              const entry = findLibraryEntry(opts.variables, ref.agentId);
              if (!entry) {
                resultText = safeJsonStringify({
                  error: `library_agent not found: ${ref.agentId}. Include "agentLibrary" in the run request.`,
                });
              } else {
                const subConfig = resolveLlmConfig({
                  ...opts.openAiConfig,
                  model: entry.model?.trim() || opts.model,
                });
                if (!subConfig.apiKey) {
                  resultText = safeJsonStringify({
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
                        content: `Tool payload:\n${safeJsonStringify(parsedArgs)}`,
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
            const errMsg = e instanceof Error ? e.message : String(e);
            resultText = safeJsonStringify({ error: errMsg });
            dbg.error("===== TOOL EXECUTION THREW =====", {
              turn: iter,
              toolCallId: call.id,
              toolName,
              error: errMsg,
              stack: e instanceof Error ? e.stack : undefined,
            });
          }
        }

        const toolDurationMs = Date.now() - toolStartedAt;

        // Detect error in result
        let toolOk = true;
        let toolErrorMsg: string | undefined;
        try {
          const parsed = JSON.parse(resultText) as { error?: unknown };
          if (parsed?.error !== undefined && parsed.error !== null) {
            toolOk = false;
            toolErrorMsg =
              typeof parsed.error === "string"
                ? parsed.error
                : safeJsonStringify(parsed.error);
          }
        } catch {
          /* not JSON — treat as success */
        }

        // ── TOOL EXECUTION END ──────────────────────────────────────────
        dbg.info("===== TOOL EXECUTION END =====", {
          turn: iter,
          toolCallId: call.id,
          toolName,
          toolIndex: idx,
          durationMs: toolDurationMs,
          ok: toolOk,
          resultType: typeof resultText,
          resultChars: resultText.length,
          resultPreview: truncateLargePayload(resultText, 400),
          resultIsJson: (() => {
            try { JSON.parse(resultText); return true; } catch { return false; }
          })(),
          oversized: resultText.length > TOOL_RESULT_WARN_LIMIT,
          errorInResult: toolOk ? null : toolErrorMsg,
        });

        // Cap oversized results
        resultText = capToolResult(resultText, dbg, toolName, iter);

        // Ensure content is always a string
        const toolContent =
          typeof resultText === "string" ? resultText : safeJsonStringify(resultText);

        // ── SENDING TOOL RESULT BACK TO OPENAI ─────────────────────────
        // This is the most critical log — shows the exact message structure
        // that will be sent on the next OpenAI call.
        const pendingMessages = [
          ...messages,
          { role: "tool", tool_call_id: call.id, content: toolContent },
        ];
        const validation = validateToolProtocol(
          pendingMessages as Parameters<typeof validateToolProtocol>[0],
        );

        dbg.info("===== SENDING TOOL RESULT BACK TO OPENAI =====", {
          turn: iter,
          toolCallId: call.id,
          toolName,
          toolContentChars: toolContent.length,
          toolContentPreview: truncateLargePayload(toolContent, 500),
          toolContentIsString: typeof toolContent === "string",
          // Full message structure for protocol debugging
          messageStructure: {
            totalMessages: pendingMessages.length,
            roleOrder: pendingMessages.map((m) => {
              const r = (m as { role?: string }).role ?? "?";
              const tc = (m as { tool_calls?: unknown[] }).tool_calls;
              return tc?.length ? `${r}[tool_calls:${tc.length}]` : r;
            }),
            lastAssistantToolCallIds:
              msg.tool_calls?.map((tc) => tc.id) ?? [],
            thisToolCallId: call.id,
            toolCallIdMatch: msg.tool_calls?.some((tc) => tc.id === call.id) ?? false,
          },
          // Protocol validation
          protocolValid: validation.valid,
          protocolViolations: validation.violations,
          totalPayloadChars: validation.totalPayloadChars,
          payloadWarning: validation.warningPayloadChars,
        });

        if (!validation.valid) {
          dbg.error("===== PROTOCOL VIOLATION DETECTED =====", {
            turn: iter,
            toolCallId: call.id,
            toolName,
            violations: validation.violations,
            note: "Sending malformed messages to OpenAI will cause tool continuation to fail or hang",
          });
          // Throw on critical violations that will definitely cause hangs
          const critical = validation.violations.filter(
            (v) =>
              v.code === "MISSING_TOOL_CALL_ID" ||
              v.code === "TOOL_CALL_ID_MISMATCH" ||
              v.code === "MISSING_ASSISTANT_BEFORE_TOOL",
          );
          if (critical.length > 0) {
            throw new Error(
              `OpenAI tool protocol violation at turn ${iter} (tool: ${toolName}): ${critical.map((v) => v.detail).join("; ")}`,
            );
          }
        }

        // Push tool result message
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: toolContent,
        });

        if (!toolOk && toolErrorMsg) {
          batchToolError = batchToolError ?? toolErrorMsg;
        }
      } // end for each tool call

      if (batchToolError) {
        dbg.error("===== TOOL BATCH ERROR =====", {
          turn: iter,
          error: batchToolError,
          note: "At least one tool in this batch returned an error result",
        });
        throw new Error(batchToolError);
      }

      anyToolRoundCompletedOk = true;
      continue; // next iteration — send tool results back to model
    }

    // ── No tool calls — check for text output ─────────────────────────────
    const c = msg.content;
    const textOut = typeof c === "string" ? c : "";

    if (textOut.trim().length > 0) {
      dbg.info("===== STREAM END =====", {
        totalIterations: iter + 1,
        totalDurationMs: Date.now() - loopStartedAt,
        outputLength: textOut.length,
        outputPreview: truncateLargePayload(textOut, 300),
        finishReason: finish,
        exitReason: "text_output",
      });
      return textOut;
    }

    if (opts.tools.length > 0) {
      if (anyToolRoundCompletedOk) {
        dbg.info("===== STREAM END =====", {
          totalIterations: iter + 1,
          totalDurationMs: Date.now() - loopStartedAt,
          outputLength: 0,
          finishReason: finish,
          exitReason: "empty_after_tool_rounds",
          note: "Model returned empty content after tool rounds — treating as success",
        });
        return textOut;
      }
      dbg.error("===== STREAM END — NO TOOLS CALLED =====", {
        turn: iter,
        finishReason: finish,
        toolCount: opts.tools.length,
        anyToolRoundCompletedOk,
        note: "Model returned empty content without calling any tools",
      });
      throw new Error(
        "Model returned empty content without calling tools. For turns that must run workflow tools, the model must issue tool_calls; for text-only turns (no tools), provide non-empty text.",
      );
    }

    if (finish === "stop" || finish === "length") {
      dbg.info("===== STREAM END =====", {
        totalIterations: iter + 1,
        totalDurationMs: Date.now() - loopStartedAt,
        finishReason: finish,
        outputLength: 0,
        exitReason: "finish_reason_stop_or_length",
      });
      return textOut;
    }

    dbg.error("===== STREAM END — UNEXPECTED =====", {
      turn: iter,
      finishReason: finish,
      contentLength: textOut.length,
      hasToolCalls: false,
      note: "Model returned empty content without tool calls and without stop/length finish_reason",
    });
    throw new Error("Model returned empty content without tool calls");
  }

  // ── Max iterations exceeded ───────────────────────────────────────────────
  dbg.error("===== STREAM END — MAX ITERATIONS =====", {
    maxIterations,
    totalDurationMs: Date.now() - loopStartedAt,
    messageCount: messages.length,
    anyToolRoundCompletedOk,
    note: "Tool loop hit maxIterations cap — possible recursive tool loop or model not converging",
    messageSummary: summarizeMessages(
      messages as Parameters<typeof summarizeMessages>[0],
      5,
    ),
  });

  throw new Error(
    `OpenAI tool loop exceeded max iterations (${maxIterations})`,
  );
}
