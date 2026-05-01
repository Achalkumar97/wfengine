/**
 * GitHub REST `repo` objects may include `temp_clone_token` and many redundant
 * API href templates. Expose only a small public card in workflow outputs.
 */
export function pickRepoSummary(
  repo: Record<string, unknown>,
): Record<string, unknown> {
  const slimOrg = (
    o: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined => {
    if (!o) return undefined;
    const login = o.login;
    const html_url = o.html_url;
    const type = o.type;
    if (login === undefined && html_url === undefined) return undefined;
    const x: Record<string, unknown> = {};
    if (login !== undefined) x.login = login;
    if (html_url !== undefined) x.html_url = html_url;
    if (type !== undefined) x.type = type;
    return x;
  };

  let license: unknown = repo.license;
  if (license && typeof license === "object" && !Array.isArray(license)) {
    const L = license as Record<string, unknown>;
    license = {
      key: L.key,
      name: L.name,
      spdx_id: L.spdx_id,
    };
  }

  const topics = Array.isArray(repo.topics)
    ? (repo.topics as unknown[]).slice(0, 24)
    : repo.topics;

  const perms = repo.permissions;
  let permissions: Record<string, unknown> | undefined;
  if (perms && typeof perms === "object" && !Array.isArray(perms)) {
    const p = perms as Record<string, unknown>;
    permissions = {
      admin: p.admin,
      maintain: p.maintain,
      push: p.push,
      triage: p.triage,
      pull: p.pull,
    };
  }

  const owner = slimOrg(repo.owner as Record<string, unknown> | undefined);
  const organization = slimOrg(
    repo.organization as Record<string, unknown> | undefined,
  );

  const card: Record<string, unknown> = {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    private: repo.private,
    html_url: repo.html_url,
    description: repo.description,
    default_branch: repo.default_branch,
    language: repo.language,
    visibility: repo.visibility,
    size: repo.size,
    created_at: repo.created_at,
    updated_at: repo.updated_at,
    pushed_at: repo.pushed_at,
    open_issues_count: repo.open_issues_count,
    forks_count: repo.forks_count,
    stargazers_count: repo.stargazers_count,
    has_issues: repo.has_issues,
    has_wiki: repo.has_wiki,
    has_pages: repo.has_pages,
    topics,
    license,
    allow_forking: repo.allow_forking,
    is_template: repo.is_template,
  };

  if (owner) card.owner = owner;
  if (organization) card.organization = organization;
  if (permissions) card.permissions = permissions;

  return Object.fromEntries(
    Object.entries(card).filter(([, v]) => v !== undefined),
  );
}
