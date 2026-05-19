/**
 * tool-loop-debug.ts
 *
 * Production-grade debugging utilities for the OpenAI tool loop.
 * Used exclusively by openai-tool-loop.ts and related orchestrators.
 *
 * Provides:
 *   - safeJsonStringify()       — circular-safe serialisation
 *   - truncateLargePayload()    — cap strings at a safe display length
 *   - summarizeMessages()       — compact message-array summary for logs
 *   - validateToolProtocol()    — pre-flight check before sending to OpenAI
 *   - ToolLoopDebugLogger       — typed wrapper around WorkflowLogger
 */

import type { WorkflowLogger } from "@wfengine/core";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Characters beyond this are replaced with "…[truncated N chars]" in logs. */
export const LOG_PAYLOAD_LIMIT = 2_000;

/** Characters beyond this trigger a warning about oversized tool results. */
export const TOOL_RESULT_WARN_LIMIT = 50_000;

/** Characters beyond this are hard-capped before sending to OpenAI. */
export const TOOL_RESULT_HARD_LIMIT = 200_000;

// ─── safeJsonStringify ───────────────────────────────────────────────────────

/**
 * JSON.stringify that handles circular references and non-serialisable values.
 * Returns a string — never throws.
 */
export function safeJsonStringify(
  value: unknown,
  indent?: number,
): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, val) => {
        if (val !== null && typeof val === "object") {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        if (typeof val === "bigint") return `[BigInt:${val.toString()}]`;
        if (typeof val === "function") return `[Function:${val.name || "anonymous"}]`;
        if (typeof val === "symbol") return `[Symbol:${val.toString()}]`;
        if (val instanceof Error) {
          return { __error: true, name: val.name, message: val.message };
        }
        return val as unknown;
      },
      indent,
    ) ?? "undefined";
  } catch (e) {
    return `[safeJsonStringify failed: ${e instanceof Error ? e.message : String(e)}]`;
  }
}

// ─── truncateLargePayload ────────────────────────────────────────────────────

/**
 * Truncate a string to `limit` characters, appending a note about how many
 * characters were removed. Safe to call on any value — non-strings are
 * serialised first.
 */
export function truncateLargePayload(
  value: unknown,
  limit = LOG_PAYLOAD_LIMIT,
): string {
  const str =
    typeof value === "string" ? value : safeJsonStringify(value);
  if (str.length <= limit) return str;
  const removed = str.length - limit;
  return `${str.slice(0, limit)}…[truncated ${removed} chars, total ${str.length}]`;
}

// ─── summarizeMessages ───────────────────────────────────────────────────────

type AnyMsg = {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
  tool_call_id?: string;
  name?: string;
};

/**
 * Produce a compact summary of a messages array for log output.
 * Shows total count, role distribution, and the last N messages in detail.
 */
export function summarizeMessages(
  messages: AnyMsg[],
  lastN = 3,
): {
  totalCount: number;
  roleCounts: Record<string, number>;
  lastMessages: Array<{
    index: number;
    role: string;
    contentPreview: string;
    toolCallIds?: string[];
    toolCallId?: string;
    toolCallCount?: number;
  }>;
  messageOrder: string[];
} {
  const roleCounts: Record<string, number> = {};
  const messageOrder: string[] = [];

  for (const m of messages) {
    const role = m.role ?? "unknown";
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    if (m.tool_calls?.length) {
      messageOrder.push(`assistant[tool_calls:${m.tool_calls.length}]`);
    } else {
      messageOrder.push(role);
    }
  }

  const slice = messages.slice(-lastN);
  const lastMessages = slice.map((m, i) => {
    const absIndex = messages.length - slice.length + i;
    const role = m.role ?? "unknown";
    const contentPreview = truncateLargePayload(m.content ?? "", 200);
    const entry: ReturnType<typeof summarizeMessages>["lastMessages"][number] =
      { index: absIndex, role, contentPreview };

    if (m.tool_calls?.length) {
      entry.toolCallIds = m.tool_calls.map((tc) => tc.id ?? "?");
      entry.toolCallCount = m.tool_calls.length;
    }
    if (m.tool_call_id) {
      entry.toolCallId = m.tool_call_id;
    }
    return entry;
  });

  return { totalCount: messages.length, roleCounts, lastMessages, messageOrder };
}

// ─── validateToolProtocol ────────────────────────────────────────────────────

export interface ToolProtocolViolation {
  code:
    | "MISSING_TOOL_CALL_ID"
    | "ORPHAN_TOOL_MESSAGE"
    | "TOOL_BEFORE_ASSISTANT"
    | "DUPLICATE_TOOL_CALL_ID"
    | "NON_STRING_TOOL_CONTENT"
    | "UNDEFINED_FIELD"
    | "OVERSIZED_PAYLOAD"
    | "MISSING_ASSISTANT_BEFORE_TOOL"
    | "TOOL_CALL_ID_MISMATCH";
  messageIndex: number;
  detail: string;
}

export interface ToolProtocolValidationResult {
  valid: boolean;
  violations: ToolProtocolViolation[];
  totalPayloadChars: number;
  warningPayloadChars: boolean;
}

/**
 * Validate the full messages array against OpenAI tool-calling protocol rules.
 *
 * Rules checked:
 *   1. Every tool message must have a non-empty tool_call_id
 *   2. Every tool message must be preceded by an assistant message with matching tool_calls
 *   3. No duplicate tool_call_ids in a single assistant→tool batch
 *   4. Tool content must be a string (not object/undefined)
 *   5. No undefined/null fields in critical positions
 *   6. Total payload size warning at TOOL_RESULT_WARN_LIMIT
 */
export function validateToolProtocol(
  messages: AnyMsg[],
): ToolProtocolValidationResult {
  const violations: ToolProtocolViolation[] = [];
  let totalPayloadChars = 0;

  // Track the most recent assistant tool_call_ids for matching
  let pendingToolCallIds: Set<string> = new Set();
  let lastAssistantWithToolCallsIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const role = m.role ?? "unknown";

    // Accumulate payload size
    const contentStr =
      typeof m.content === "string"
        ? m.content
        : m.content == null
          ? ""
          : safeJsonStringify(m.content);
    totalPayloadChars += contentStr.length;

    if (role === "assistant") {
      if (m.tool_calls?.length) {
        // Reset pending set for this batch
        pendingToolCallIds = new Set();
        lastAssistantWithToolCallsIndex = i;

        for (const tc of m.tool_calls) {
          if (!tc.id || tc.id.trim() === "") {
            violations.push({
              code: "MISSING_TOOL_CALL_ID",
              messageIndex: i,
              detail: `assistant message at index ${i} has a tool_call with missing/empty id (function: ${tc.function?.name ?? "?"})`,
            });
          } else {
            if (pendingToolCallIds.has(tc.id)) {
              violations.push({
                code: "DUPLICATE_TOOL_CALL_ID",
                messageIndex: i,
                detail: `Duplicate tool_call_id "${tc.id}" in assistant message at index ${i}`,
              });
            }
            pendingToolCallIds.add(tc.id);
          }
        }
      } else {
        // Plain assistant message — clear pending
        pendingToolCallIds = new Set();
        lastAssistantWithToolCallsIndex = -1;
      }
    } else if (role === "tool") {
      // Must have tool_call_id
      if (!m.tool_call_id || m.tool_call_id.trim() === "") {
        violations.push({
          code: "MISSING_TOOL_CALL_ID",
          messageIndex: i,
          detail: `tool message at index ${i} is missing tool_call_id`,
        });
      }

      // Must follow an assistant message with tool_calls
      if (lastAssistantWithToolCallsIndex === -1) {
        violations.push({
          code: "MISSING_ASSISTANT_BEFORE_TOOL",
          messageIndex: i,
          detail: `tool message at index ${i} (tool_call_id: "${m.tool_call_id ?? "?"}") has no preceding assistant message with tool_calls`,
        });
      } else if (m.tool_call_id && !pendingToolCallIds.has(m.tool_call_id)) {
        violations.push({
          code: "TOOL_CALL_ID_MISMATCH",
          messageIndex: i,
          detail: `tool message at index ${i} has tool_call_id "${m.tool_call_id}" which does not match any pending tool_call_id from assistant at index ${lastAssistantWithToolCallsIndex}. Pending: [${[...pendingToolCallIds].join(", ")}]`,
        });
      }

      // Content must be a string
      if (typeof m.content !== "string") {
        violations.push({
          code: "NON_STRING_TOOL_CONTENT",
          messageIndex: i,
          detail: `tool message at index ${i} has non-string content (type: ${typeof m.content}). OpenAI requires tool content to be a string.`,
        });
      }

      // Check for oversized individual tool result
      if (typeof m.content === "string" && m.content.length > TOOL_RESULT_WARN_LIMIT) {
        violations.push({
          code: "OVERSIZED_PAYLOAD",
          messageIndex: i,
          detail: `tool message at index ${i} content is ${m.content.length} chars (warn limit: ${TOOL_RESULT_WARN_LIMIT}). Consider truncating tool results.`,
        });
      }

      // Remove from pending once matched
      if (m.tool_call_id) pendingToolCallIds.delete(m.tool_call_id);
    }

    // Check for undefined in role
    if (m.role === undefined || m.role === null) {
      violations.push({
        code: "UNDEFINED_FIELD",
        messageIndex: i,
        detail: `message at index ${i} has undefined/null role`,
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    totalPayloadChars,
    warningPayloadChars: totalPayloadChars > TOOL_RESULT_WARN_LIMIT,
  };
}

// ─── ToolLoopDebugLogger ─────────────────────────────────────────────────────

export interface DebugContext {
  executionId?: string;
  workflowId?: string;
  nodeId?: string;
  agentName?: string;
  model?: string;
  provider?: string;
}

/**
 * Typed wrapper around WorkflowLogger that stamps every entry with
 * the debug context and a wall-clock timestamp.
 */
export class ToolLoopDebugLogger {
  private readonly log: WorkflowLogger;
  private readonly ctx: DebugContext;

  constructor(logger: WorkflowLogger, ctx: DebugContext) {
    this.log = logger;
    this.ctx = ctx;
  }

  private stamp(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      timestamp: new Date().toISOString(),
      executionId: this.ctx.executionId,
      workflowId: this.ctx.workflowId,
      nodeId: this.ctx.nodeId,
      agentName: this.ctx.agentName,
      model: this.ctx.model,
      provider: this.ctx.provider,
      ...extra,
    };
  }

  debug(label: string, extra: Record<string, unknown> = {}): void {
    this.log.debug(label, this.stamp(extra));
  }

  info(label: string, extra: Record<string, unknown> = {}): void {
    this.log.info(label, this.stamp(extra));
  }

  warn(label: string, extra: Record<string, unknown> = {}): void {
    this.log.warn(label, this.stamp(extra));
  }

  error(label: string, extra: Record<string, unknown> = {}): void {
    this.log.error(label, this.stamp(extra));
  }

  /** Log a protocol validation result — always logs violations, warns on oversized. */
  logValidation(
    label: string,
    result: ToolProtocolValidationResult,
    turn: number,
  ): void {
    if (!result.valid) {
      this.error(label, {
        turn,
        valid: false,
        violationCount: result.violations.length,
        violations: result.violations,
        totalPayloadChars: result.totalPayloadChars,
      });
    } else if (result.warningPayloadChars) {
      this.warn(label, {
        turn,
        valid: true,
        totalPayloadChars: result.totalPayloadChars,
        note: `Total payload ${result.totalPayloadChars} chars exceeds warn limit ${TOOL_RESULT_WARN_LIMIT}`,
      });
    } else {
      this.debug(label, {
        turn,
        valid: true,
        totalPayloadChars: result.totalPayloadChars,
      });
    }
  }
}

// ─── buildFallbackLogger ─────────────────────────────────────────────────────

/**
 * Build a WorkflowLogger that writes to console when no logger is injected.
 * Avoids the circular-reference issue of `const log = { child: () => log }`.
 */
export function buildFallbackLogger(): WorkflowLogger {
  function makeLogger(prefix: string): WorkflowLogger {
    const logger: WorkflowLogger = {
      debug: (msg, meta) =>
        meta ? console.debug(`${prefix}${msg}`, meta) : console.debug(`${prefix}${msg}`),
      info: (msg, meta) =>
        meta ? console.info(`${prefix}${msg}`, meta) : console.info(`${prefix}${msg}`),
      warn: (msg, meta) =>
        meta ? console.warn(`${prefix}${msg}`, meta) : console.warn(`${prefix}${msg}`),
      error: (msg, meta) =>
        meta ? console.error(`${prefix}${msg}`, meta) : console.error(`${prefix}${msg}`),
      child: (bindings) => {
        const childPrefix = Object.entries(bindings)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(" ");
        return makeLogger(`[${childPrefix}] `);
      },
    };
    return logger;
  }
  return makeLogger("");
}
