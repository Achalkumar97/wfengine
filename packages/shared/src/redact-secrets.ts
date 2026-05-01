/**
 * Redact common secret keys and token-shaped string values for safe client-facing
 * payloads (defense in depth; not a full DLP system).
 */
const SENSITIVE_KEY_RE =
  /^(password|pass|secret|token|api[_-]?key|auth|authorization|bearer|client_secret|github[_-]?token|openai[_-]?api[_-]?key|temp_clone_token|connectionString|connection_string|authPass|authUser)$/i;

const TOKEN_VALUE_RE =
  /^(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]+|xox[bap]-[0-9A-Za-z-]+|sk-[A-Za-z0-9]{20,})/;

const MAX_DEPTH = 24;

export function redactSecretsDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[redacted]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (TOKEN_VALUE_RE.test(value)) return "[redacted]";
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.map((v) => redactSecretsDeep(v, depth + 1));
  }
  if (typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = redactSecretsDeep(v, depth + 1);
  }
  return out;
}
