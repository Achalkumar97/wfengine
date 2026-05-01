/** Shared GitHub REST helpers for nodes under `nodes/github/`. */

const API = "https://api.github.com";

export function authHeaders(token: string | undefined): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function formatGitHubFailure(status: number, path: string, body: string): Error {
  const trimmed = body.slice(0, 800);

  if (status === 403 && /SAML/i.test(body)) {
    return new Error(
      [
        "GitHub returned 403: this organization enforces SAML SSO.",
        "",
        "Your Personal Access Token must be authorized for SSO with that org (wfengine cannot bypass this).",
        "",
        "Steps:",
        "1. GitHub.com (same account that created the token) → Settings → Developer settings → Personal access tokens.",
        "2. Open your token → find “SAML single sign-on” / “Configure SSO” → Authorize next to the organization.",
        "3. Complete your company IdP login if prompted.",
        "4. Put the same token in github.repo.analyze (and github.repo.run-tests if cloning a private org repo).",
        "",
        `API path: ${path}`,
        `GitHub said: ${trimmed}`,
      ].join("\n"),
    );
  }

  if (status === 404 && path.includes("/repos/")) {
    return new Error(
      [
        `GitHub API 404 ${path}: repo not found or not visible.`,
        "Private repos need a PAT: set it on GitHub: Analyze repo (it propagates to downstream GitHub nodes), or set `GITHUB_TOKEN` / `WFENGINE_GITHUB_TOKEN` on the runner.",
        "Confirm `repo` scope and SAML SSO authorization for the org if applicable.",
        trimmed,
      ].join(" "),
    );
  }

  return new Error(`GitHub API ${status} ${path}: ${trimmed}`);
}

export async function ghJson<T>(
  path: string,
  token: string | undefined,
): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: authHeaders(token) });
  if (!res.ok) {
    const t = await res.text();
    throw formatGitHubFailure(res.status, path, t);
  }
  return (await res.json()) as T;
}
