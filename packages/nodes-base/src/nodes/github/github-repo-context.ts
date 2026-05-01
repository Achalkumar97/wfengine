/**
 * Resolve GitHub owner/repo/ref from node config plus merged upstream payload.
 * Supports flat `gitOwner` / `gitRepo` / `gitRef` (e.g. from `github.repo.analyze`)
 * and nested `repoInfo` (e.g. from `github.files.read`).
 */
export function resolveGithubRepoContext(
  config: {
    owner?: string | undefined;
    repo?: string | undefined;
    ref?: string | undefined;
  },
  upstream: Record<string, unknown>,
  refFallback = "main",
): { owner: string; repo: string; ref: string } {
  let owner = String(config.owner ?? upstream.gitOwner ?? "").trim();
  let repo = String(config.repo ?? upstream.gitRepo ?? "").trim();
  let ref = String(config.ref ?? upstream.gitRef ?? "").trim();

  if ((!owner || !repo || !ref) && upstream.repoInfo) {
    const ri = upstream.repoInfo;
    if (ri && typeof ri === "object" && !Array.isArray(ri)) {
      const o = ri as Record<string, unknown>;
      if (!owner && typeof o.owner === "string") owner = o.owner.trim();
      if (!repo && typeof o.repo === "string") repo = o.repo.trim();
      if (!ref && typeof o.ref === "string") ref = o.ref.trim();
    }
  }

  if (!ref) ref = refFallback;
  return { owner, repo, ref };
}
