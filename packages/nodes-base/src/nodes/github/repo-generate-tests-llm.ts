import type { NodeDefinition } from "@wfengine/core";
import { z } from "zod";
import {
  GeneratedTestFileEntrySchema,
  GeneratedTestSummaryEntrySchema,
  GitHubRepoGenerateTestsLlmConfigSchema,
  GitHubRepoGenerateTestsLlmOutputSchema,
} from "../../config-schemas.js";
import {
  buildFallbackGeneratedTestSummary,
  buildGenerateTestsSystemPrompt,
  buildGenerateTestsUserPrompt,
  callOpenAiCompatibleJson,
  formatUpstreamAnalyzeHints,
  MAX_OUTPUT_FILES,
  parseAndValidateLlmFilesResponse,
  rankSourcePathsForTestGeneration,
  summarizePackageJsonForPrompt,
} from "./generate-tests-llm.js";
import {
  fetchRepoFileUtf8,
  resolveCommitSha,
} from "./github-repo-contents.js";
import { resolveGithubToken } from "./github-token-resolve.js";

export {
  GitHubRepoGenerateTestsLlmConfigSchema,
  GitHubRepoGenerateTestsLlmOutputSchema,
} from "../../config-schemas.js";

function isTestPath(p: string): boolean {
  const n = p.toLowerCase();
  return (
    n.includes("__tests__") ||
    n.includes("/test/") ||
    n.includes("/tests/") ||
    n.includes(".test.") ||
    n.includes(".spec.") ||
    n.endsWith("_test.py") ||
    n.endsWith("_test.go")
  );
}

function isLikelySourcePath(p: string): boolean {
  return /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py)$/i.test(p);
}

export const githubRepoGenerateTestsLlmNode: NodeDefinition = {
  type: "github.repo.generate-tests-llm",
  label: "GitHub: Generate tests (LLM)",
  category: "action",
  description:
    "Fetch source files from GitHub, ask an OpenAI-compatible model for unit test files, output `generatedTestFiles` for github.repo.run-tests to write before running tests.",
  configSchema:
    GitHubRepoGenerateTestsLlmConfigSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  outputSchema:
    GitHubRepoGenerateTestsLlmOutputSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  execute: async ({ config, inputData, context }) => {
    const c = GitHubRepoGenerateTestsLlmConfigSchema.parse(config);
    const upstream = inputData as Record<string, unknown>;

    const owner = String(c.owner ?? upstream.gitOwner ?? "").trim();
    const repo = String(c.repo ?? upstream.gitRepo ?? "").trim();
    const ref =
      String(c.ref ?? upstream.gitRef ?? "").trim() || "main";

    if (!owner || !repo) {
      throw new Error(
        "github.repo.generate-tests-llm: set owner/repo or connect after github.repo.analyze (gitOwner/gitRepo).",
      );
    }

    const rawSources = upstream.sourceFiles;
    const sourceList = Array.isArray(rawSources)
      ? rawSources.filter((x): x is string => typeof x === "string")
      : [];

    const candidates = sourceList.filter(
      (p) => isLikelySourcePath(p) && !isTestPath(p),
    );
    const ranked = rankSourcePathsForTestGeneration(candidates);
    const picked = ranked.slice(0, c.maxSourceFiles);

    if (picked.length === 0) {
      throw new Error(
        "github.repo.generate-tests-llm: upstream has no `sourceFiles` (non-test paths). Run github.repo.analyze before this node.",
      );
    }

    context.logger.info("LLM generate-tests: resolving ref + fetching sources", {
      repo: `${owner}/${repo}`,
      ref,
      picked,
    });

    const ghTok = resolveGithubToken(c.githubToken, upstream);
    const sha = await resolveCommitSha(owner, repo, ref, ghTok);

    let packageJsonSection = "";
    try {
      const pkgRaw = await fetchRepoFileUtf8(
        owner,
        repo,
        "package.json",
        sha,
        ghTok,
      );
      if (pkgRaw !== null) {
        packageJsonSection = summarizePackageJsonForPrompt(pkgRaw);
      }
    } catch (e) {
      context.logger.warn("package.json fetch skipped", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const sourceBundlesMarkdown: string[] = [];
    const pathsWithContent: string[] = [];

    for (const path of picked) {
      try {
        let text = await fetchRepoFileUtf8(owner, repo, path, sha, ghTok);
        if (text === null) continue;
        if (text.length > c.maxCharsPerFile) {
          text = `${text.slice(0, c.maxCharsPerFile)}\n\n/* …truncated for LLM context … */`;
        }
        pathsWithContent.push(path);
        sourceBundlesMarkdown.push(
          `### Source file: \`${path}\`\n\n\`\`\`\n${text}\n\`\`\`\n`,
        );
      } catch (e) {
        context.logger.warn("Skip source file (fetch failed)", {
          path,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (sourceBundlesMarkdown.length === 0) {
      throw new Error(
        "github.repo.generate-tests-llm: could not read any source file contents (404 or not a file). Check token and paths.",
      );
    }

    const fw = c.framework;
    const system = buildGenerateTestsSystemPrompt(fw, MAX_OUTPUT_FILES);
    const upstreamAnalyzeSection = formatUpstreamAnalyzeHints(upstream);
    const userMsg = buildGenerateTestsUserPrompt({
      owner,
      repo,
      ref,
      resolvedCommitSha: sha,
      sourceFilePaths: pathsWithContent,
      sourceBundlesMarkdown,
      packageJsonSection,
      upstreamAnalyzeSection,
    });

    let generated: z.infer<typeof GeneratedTestFileEntrySchema>[] = [];
    let summaryRows: z.infer<typeof GeneratedTestSummaryEntrySchema>[] = [];
    let warning: string | undefined;

    try {
      const rawJson = await callOpenAiCompatibleJson({
        baseUrl: c.openAiBaseUrl ?? "",
        apiKey: c.openAiApiKey ?? "",
        model: c.model,
        system,
        user: userMsg,
        temperature: c.temperature,
        maxTokens: c.llmMaxTokens,
        timeoutMs: c.llmTimeoutMs,
      });

      const { files, generatedTestSummary: summ, messages } =
        parseAndValidateLlmFilesResponse(rawJson);
      generated = files;
      summaryRows =
        summ.length > 0
          ? summ
          : buildFallbackGeneratedTestSummary(generated, pathsWithContent);

      const parts: string[] = [...messages];
      if (
        generated.length === 0 &&
        parts.length === 0
      ) {
        parts.push(
          "Model returned no test files (empty or invalid `files` array, or all entries failed validation).",
        );
      }
      if (parts.length > 0) {
        warning = parts.join(" ");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warning = msg;
      context.logger.warn("LLM generate-tests failed", { warning });
      if (generated.length > 0 && summaryRows.length === 0) {
        summaryRows = buildFallbackGeneratedTestSummary(
          generated,
          pathsWithContent,
        );
      }
    }

    const output = {
      generatedTestFiles: generated,
      generatedTestSummary: summaryRows,
      llmModel: c.model,
      sourceFilesUsed: pathsWithContent,
      generateWarning: warning,
      gitOwner: owner,
      gitRepo: repo,
      gitRef: ref,
      ...(ghTok ? { githubToken: ghTok } : {}),
    };

    GitHubRepoGenerateTestsLlmOutputSchema.parse(output);

    return output;
  },
};
