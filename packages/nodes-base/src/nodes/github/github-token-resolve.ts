/** Placeholder strings returned after client-side secret redaction — never treat as real credentials. */
function isRedactedPlaceholder(s: string): boolean {
  const t = s.trim();
  return (
    t === "[redacted]" ||
    t === "***" ||
    /^<redacted/i.test(t) ||
    /^__wfengine_redacted__/i.test(t)
  );
}

/**
 * Resolve GitHub PAT for REST calls. Order: node config → merged `githubToken`
 * from upstream (echoed by `github.repo.analyze` and passed through Read / LLM) →
 * `WFENGINE_GITHUB_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN` on the process.
 */
export function resolveGithubToken(
  configToken: string | undefined,
  upstream: Record<string, unknown>,
): string | undefined {
  const fromConfig = configToken?.trim();
  if (fromConfig && !isRedactedPlaceholder(fromConfig)) return fromConfig;

  const up = upstream.githubToken;
  if (typeof up === "string" && up.trim() && !isRedactedPlaceholder(up))
    return up.trim();

  if (typeof process !== "undefined" && process.env) {
    const env =
      process.env.WFENGINE_GITHUB_TOKEN?.trim() ||
      process.env.GITHUB_TOKEN?.trim() ||
      process.env.GH_TOKEN?.trim() ||
      "";
    if (env) return env;
  }

  return undefined;
}
