/**
 * Nodes may return `{ success: false, message, ... }` instead of throwing.
 * The engine treats that as a failure like a thrown error.
 */
export function formatStructuredNodeFailureMessage(
  nodeId: string,
  nodeType: string | undefined,
  out: unknown,
): string | null {
  if (out === null || typeof out !== "object" || Array.isArray(out)) {
    return null;
  }
  const o = out as Record<string, unknown>;
  if (o.success !== false) return null;

  const title =
    typeof o.error === "string" && o.error.length > 0
      ? o.error
      : "Node reported failure";
  const detail =
    typeof o.message === "string" && o.message.length > 0 ? o.message : "";
  const missing = Array.isArray(o.missingFields)
    ? o.missingFields.filter((x): x is string => typeof x === "string")
    : [];

  const header = nodeType
    ? `Node "${nodeId}" (${nodeType})`
    : `Node "${nodeId}"`;

  let body = `${header}: ${title}`;
  if (missing.length > 0) {
    body += `. Missing field(s): ${missing.join(", ")}`;
  }
  if (detail) {
    body += `. ${detail}`;
  }
  return body;
}
