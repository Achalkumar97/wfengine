import type { WorkflowLogger } from "@wfengine/core";

/**
 * Serialize merged workflow input for LLM user messages.
 * Truncates to keep requests bounded.
 */
const MAX_JSON_CHARS = 120_000;

export function upstreamToJsonText(input: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(input, null, 2);
    if (s.length <= MAX_JSON_CHARS) return s;
    return `${s.slice(0, MAX_JSON_CHARS)}\n/* …truncated… */`;
  } catch {
    return String(input);
  }
}

/** When `runDate` is listed in required upstream fields but absent or blank, set today's UTC date (YYYY-MM-DD). */
export function applyDefaultRunDateIfNeeded(
  upstream: Record<string, unknown>,
  requiredFields: readonly string[] | undefined,
  logger?: WorkflowLogger,
): void {
  if (!requiredFields?.includes("runDate")) return;
  const v = upstream["runDate"];
  if (v !== undefined && v !== null && String(v).trim() !== "") return;
  const iso = new Date().toISOString().slice(0, 10);
  upstream["runDate"] = iso;
  logger?.info("upstream: defaulted missing runDate to today (UTC)", {
    runDate: iso,
  });
}
