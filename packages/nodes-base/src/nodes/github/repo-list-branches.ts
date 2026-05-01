import type { NodeDefinition } from "@wfengine/core";
import { z } from "zod";
import {
  GitHubBranchInfoSchema,
  GitHubRepoListBranchesConfigSchema,
  GitHubRepoListBranchesOutputSchema,
  GitHubTagInfoSchema,
} from "../../config-schemas.js";

export {
  GitHubRepoListBranchesConfigSchema,
  GitHubRepoListBranchesOutputSchema,
} from "../../config-schemas.js";
import { ghJson } from "./gh-fetch.js";
import { resolveGithubToken } from "./github-token-resolve.js";

type BranchInfo = z.infer<typeof GitHubBranchInfoSchema>;
type TagInfo = z.infer<typeof GitHubTagInfoSchema>;

type BranchRow = {
  name: string;
  commit?: { sha?: string };
  protected?: boolean;
};

type TagRow = {
  name: string;
  commit?: { sha?: string };
};

function resolveOwnerRepo(
  c: z.infer<typeof GitHubRepoListBranchesConfigSchema>,
  inputData: Record<string, unknown>,
): { owner: string; repo: string } {
  let owner = String(c.owner ?? inputData.gitOwner ?? "").trim();
  let repo = String(c.repo ?? inputData.gitRepo ?? "").trim();

  if (!owner || !repo) {
    const repoInfo = inputData.repoInfo;
    if (repoInfo && typeof repoInfo === "object" && !Array.isArray(repoInfo)) {
      const ri = repoInfo as Record<string, unknown>;
      if (!owner && typeof ri.owner === "string") owner = ri.owner.trim();
      if (!repo && typeof ri.repo === "string") repo = ri.repo.trim();
    }
  }

  if (!owner || !repo) {
    const apiRepo = inputData.repo;
    if (apiRepo && typeof apiRepo === "object" && !Array.isArray(apiRepo)) {
      const r = apiRepo as Record<string, unknown>;
      const fn = r.full_name;
      if (typeof fn === "string" && fn.includes("/")) {
        const [o, rest] = fn.split("/", 2);
        if (!owner && o) owner = o.trim();
        if (!repo && rest) repo = rest.trim();
      }
      const login =
        r.owner &&
        typeof r.owner === "object" &&
        typeof (r.owner as { login?: string }).login === "string"
          ? (r.owner as { login: string }).login.trim()
          : "";
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (!owner && login) owner = login;
      if (!repo && name) repo = name;
    }
  }

  return { owner, repo };
}

export const githubRepoListBranchesNode: NodeDefinition = {
  type: "github.repo.list-branches",
  label: "GitHub list branches",
  category: "action",
  description:
    "List branches (and optionally tags) for a repo via the GitHub REST API. After `github.repo.analyze` (or any node with `gitOwner`/`gitRepo` or `repoInfo`), you can omit **owner**/**repo** in config.",
  configSchema:
    GitHubRepoListBranchesConfigSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  outputSchema:
    GitHubRepoListBranchesOutputSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  execute: async ({ config, inputData, context }) => {
    const c = GitHubRepoListBranchesConfigSchema.parse(config);
    const upstream = inputData as Record<string, unknown>;
    const { owner, repo } = resolveOwnerRepo(c, upstream);

    if (!owner || !repo) {
      throw new Error(
        "github.repo.list-branches: set `owner` and `repo` on this node, or connect it after `github.repo.analyze` so `gitOwner` / `gitRepo` (or `repo.full_name`) are in the workflow payload.",
      );
    }

    const token = resolveGithubToken(c.githubToken, upstream);

    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

    const repoMeta = await ghJson<{
      full_name?: string;
      default_branch?: string;
    }>(base, token);

    const fullName = repoMeta.full_name ?? `${owner}/${repo}`;
    const defaultBranch = repoMeta.default_branch ?? "main";

    const perPage = c.perPage;
    const maxPages = c.maxPages;

    const branches: BranchInfo[] = [];
    let branchesTruncated = false;

    for (let page = 1; page <= maxPages; page++) {
      const path = `${base}/branches?per_page=${perPage}&page=${page}`;
      const batch = await ghJson<BranchRow[]>(path, token);
      for (const b of batch) {
        branches.push({
          name: b.name,
          commitSha: b.commit?.sha ?? "",
          protected: b.protected,
        });
      }
      if (batch.length < perPage) break;
      if (page === maxPages && batch.length === perPage) {
        branchesTruncated = true;
      }
    }

    branches.sort((a, b) => a.name.localeCompare(b.name));
    const branchNames = branches.map((b) => b.name);

    let tags: TagInfo[] | undefined;
    let tagsTruncated: boolean | undefined;

    if (c.includeTags) {
      tags = [];
      tagsTruncated = false;
      for (let page = 1; page <= maxPages; page++) {
        const path = `${base}/tags?per_page=${perPage}&page=${page}`;
        const batch = await ghJson<TagRow[]>(path, token);
        for (const t of batch) {
          tags.push({
            name: t.name,
            commitSha: t.commit?.sha ?? "",
          });
        }
        if (batch.length < perPage) break;
        if (page === maxPages && batch.length === perPage) {
          tagsTruncated = true;
        }
      }
      tags.sort((a, b) => a.name.localeCompare(b.name));
    }

    const preview = branchNames.slice(0, 20);
    const branchSummary =
      preview.join(", ") +
      (branchNames.length > 20 ? ` … (+${branchNames.length - 20} more)` : "") +
      (branchesTruncated ? " [truncated]" : "");

    context.logger.info("GitHub list branches", {
      fullName,
      count: branchNames.length,
      branchesTruncated,
    });

    const output = {
      fullName,
      defaultBranch,
      gitOwner: owner,
      gitRepo: repo,
      branchNames,
      branches,
      branchesTruncated,
      tags,
      tagsTruncated,
      branchSummary,
    };

    GitHubRepoListBranchesOutputSchema.parse(output);

    return output;
  },
};
