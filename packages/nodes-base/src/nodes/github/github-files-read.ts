import type { NodeDefinition } from "@wfengine/core";
import { z } from "zod";
import {
  GitHubFilesReadConfigSchema,
  GitHubFilesReadOutputSchema,
} from "../../config-schemas.js";
import {
  fetchRepoFileUtf8,
  resolveCommitSha,
} from "./github-repo-contents.js";
import {
  isProbableApplicationSourcePath,
  sortPathsCorePriority,
} from "./github-smart-file-select.js";
import { resolveGithubToken } from "./github-token-resolve.js";

export {
  GitHubFilesReadConfigSchema,
  GitHubFilesReadOutputSchema,
} from "../../config-schemas.js";

const MIN_BUDGET_CHARS_TO_ACCEPT_FILE = 256;

function resolveOwnerRepo(
  c: z.infer<typeof GitHubFilesReadConfigSchema>,
  inputData: Record<string, unknown>,
): { owner: string; repo: string } {
  let owner = String(c.owner ?? inputData.gitOwner ?? "").trim();
  let repo = String(c.repo ?? inputData.gitRepo ?? "").trim();

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

function normalizeRepoRelativePath(p: string): string | null {
  const s = p.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  if (!s || s.includes("..")) return null;
  return s;
}

function dedupePathsPreserveOrder(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const n = normalizeRepoRelativePath(p);
    if (!n) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function guessLanguage(relativePath: string): string | undefined {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".py") || lower.endsWith(".pyi")) return "python";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "javascript";
  }
  if (lower.endsWith(".vue")) return "vue";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rs")) return "rust";
  return undefined;
}

function extractAnalyzeCandidates(inputData: Record<string, unknown>): string[] {
  const raw = inputData.sourceFiles;
  if (!Array.isArray(raw)) return [];
  return dedupePathsPreserveOrder(
    raw.filter((x): x is string => typeof x === "string"),
  ).filter(isProbableApplicationSourcePath);
}

function resolveTargetPaths(
  c: z.infer<typeof GitHubFilesReadConfigSchema>,
  inputData: Record<string, unknown>,
): {
  paths: string[];
  candidatesFromAnalyze: number;
  effectiveMode: "custom" | "core" | "all";
} {
  const mode = c.smartSelectMode ?? "custom";

  if (mode === "custom") {
    if (c.targetFiles.length > 0) {
      return {
        paths: dedupePathsPreserveOrder(c.targetFiles),
        candidatesFromAnalyze: 0,
        effectiveMode: "custom",
      };
    }
    const u = inputData.targetFiles;
    if (Array.isArray(u)) {
      const p = dedupePathsPreserveOrder(
        u.filter((x): x is string => typeof x === "string"),
      );
      if (p.length > 0) {
        return {
          paths: p,
          candidatesFromAnalyze: 0,
          effectiveMode: "custom",
        };
      }
    }
    return { paths: [], candidatesFromAnalyze: 0, effectiveMode: "custom" };
  }

  const candidates = extractAnalyzeCandidates(inputData);
  const n = candidates.length;
  const max = c.smartMaxFiles;

  if (n === 0) {
    return { paths: [], candidatesFromAnalyze: 0, effectiveMode: mode };
  }

  if (mode === "core") {
    return {
      paths: sortPathsCorePriority(candidates).slice(0, max),
      candidatesFromAnalyze: n,
      effectiveMode: "core",
    };
  }

  return {
    paths: [...candidates].sort((a, b) => a.localeCompare(b)).slice(0, max),
    candidatesFromAnalyze: n,
    effectiveMode: "all",
  };
}

export const githubFilesReadNode: NodeDefinition = {
  type: "github.files.read",
  label: "GitHub read files",
  category: "action",
  description:
    "Fetch UTF-8 file contents from GitHub (token for private). After `github.repo.analyze`, omit repeated **owner**/**repo**/**ref** — resolved from merged `gitOwner`/`gitRepo`/`gitRef`. Use `targetFiles` or `smartSelectMode` **core**/**all** with upstream `sourceFiles`. Outputs `files` plus flat `gitOwner`/`gitRepo`/`gitRef` for downstream.",
  configSchema:
    GitHubFilesReadConfigSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  outputSchema:
    GitHubFilesReadOutputSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  execute: async ({ config, inputData, context }) => {
    const c = GitHubFilesReadConfigSchema.parse(config);
    const upstream = inputData as Record<string, unknown>;

    const { owner, repo } = resolveOwnerRepo(c, upstream);
    if (!owner || !repo) {
      throw new Error(
        "github.files.read: set `owner` and `repo` on this node, or connect after `github.repo.analyze` so `gitOwner` / `gitRepo` (or `repo.full_name`) are in the workflow payload.",
      );
    }

    const { paths: targetPaths, candidatesFromAnalyze, effectiveMode } =
      resolveTargetPaths(c, upstream);
    if (targetPaths.length === 0) {
      if ((c.smartSelectMode ?? "custom") !== "custom") {
        throw new Error(
          "github.files.read: smartSelectMode requires non-empty merged `sourceFiles` (e.g. connect after `github.repo.analyze` with `focus: \"source\"` or `\"all\"`). Or use smartSelectMode `custom` with explicit `targetFiles`.",
        );
      }
      throw new Error(
        "github.files.read: set `targetFiles` (repo-relative paths) on this node or pass `targetFiles` from upstream.",
      );
    }

    const token = resolveGithubToken(c.githubToken, upstream);

    const ref =
      String(c.ref ?? upstream.gitRef ?? "").trim() || "main";

    context.logger.info("github.files.read: resolving ref + fetching paths", {
      repo: `${owner}/${repo}`,
      ref,
      pathCount: targetPaths.length,
      smartSelectMode: effectiveMode,
      candidatesFromAnalyze:
        candidatesFromAnalyze > 0 ? candidatesFromAnalyze : undefined,
    });

    const sha = await resolveCommitSha(owner, repo, ref, token);

    const files: z.infer<
      typeof GitHubFilesReadOutputSchema
    >["files"] = [];
    let skippedDueToSize = 0;
    let totalCharsUsed = 0;

    for (const relPath of targetPaths) {
      if (totalCharsUsed >= c.maxTotalChars) {
        skippedDueToSize += 1;
        context.logger.warn("github.files.read: maxTotalChars exhausted; skipping rest", {
          path: relPath,
        });
        continue;
      }

      let text: string | null;
      try {
        text = await fetchRepoFileUtf8(owner, repo, relPath, sha, token);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        context.logger.warn("github.files.read: fetch failed", {
          path: relPath,
          error: msg,
        });
        continue;
      }

      if (text === null) {
        context.logger.warn(
          "github.files.read: path is not a regular file (or empty)",
          { path: relPath },
        );
        continue;
      }

      if (text.length > c.maxCharsPerFile) {
        text =
          text.slice(0, c.maxCharsPerFile) +
          "\n\n/* …truncated: exceeded maxCharsPerFile … */";
      }

      const remaining = c.maxTotalChars - totalCharsUsed;
      if (text.length > remaining) {
        if (remaining < MIN_BUDGET_CHARS_TO_ACCEPT_FILE) {
          skippedDueToSize += 1;
          context.logger.warn(
            "github.files.read: skipped file — not enough room under maxTotalChars",
            { path: relPath, remaining },
          );
          continue;
        }
        text =
          text.slice(0, remaining) +
          "\n\n/* …truncated to fit maxTotalChars … */";
      }

      totalCharsUsed += text.length;
      files.push({
        relativePath: relPath,
        content: text,
        language: guessLanguage(relPath),
      });
    }

    const output = {
      files,
      repoInfo: {
        owner,
        repo,
        ref,
        commitSha: sha,
      },
      fetchSummary: {
        totalRequested: targetPaths.length,
        totalFetched: files.length,
        skippedDueToSize,
        smartSelectMode: effectiveMode,
        ...(candidatesFromAnalyze > 0
          ? { candidatesFromAnalyze }
          : {}),
      },
      /** Flat echo so later nodes need not repeat owner/repo/ref from config. */
      gitOwner: owner,
      gitRepo: repo,
      gitRef: ref,
      resolvedCommitSha: sha,
      ...(token ? { githubToken: token } : {}),
    };

    return GitHubFilesReadOutputSchema.parse(output);
  },
};
