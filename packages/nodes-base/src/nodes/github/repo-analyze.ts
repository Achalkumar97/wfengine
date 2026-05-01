import type { NodeDefinition } from "@wfengine/core";
import { z } from "zod";
import {
  GitHubRepoAnalyzeAnalysisMetaSchema,
  GitHubRepoAnalyzeConfigSchema,
  GitHubRepoAnalyzeOutputSchema,
  SuggestedTestCaseSchema,
} from "../../config-schemas.js";

export {
  GitHubRepoAnalyzeAnalysisMetaSchema,
  GitHubRepoAnalyzeConfigSchema,
  GitHubRepoAnalyzeOutputSchema,
} from "../../config-schemas.js";
import { ghJson } from "./gh-fetch.js";
import { resolveGithubToken } from "./github-token-resolve.js";
import { pickRepoSummary } from "./gh-repo-summary.js";

/** Output caps (full lists are still used internally for heuristics). */
const OUTPUT_MAX_SOURCE_FILES = 220;
const OUTPUT_MAX_TEST_FILES = 80;
const OUTPUT_MAX_SUGGESTIONS = 36;

type TreeNode = { path: string; type: string; size?: number };
type Suggestion = z.infer<typeof SuggestedTestCaseSchema>;
type Priority = Suggestion["priority"];

type PackageJsonInfo = {
  raw: Record<string, unknown>;
  scripts: Record<string, string>;
  deps: Record<string, string>;
  devDeps: Record<string, string>;
  peerDeps: Record<string, string>;
};

async function resolveCommitSha(
  owner: string,
  repo: string,
  ref: string,
  token: string | undefined,
): Promise<string> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const tries = [
    `${base}/git/ref/heads/${encodeURIComponent(ref)}`,
    `${base}/git/ref/tags/${encodeURIComponent(ref)}`,
  ];
  for (const path of tries) {
    try {
      const r = await ghJson<{ object: { sha: string; type?: string } }>(
        path,
        token,
      );
      const typ = r.object.type;
      if (typ === "commit" || !typ) return r.object.sha;
      if (typ === "tag") {
        const tag = await ghJson<{ object: { sha: string; type: string } }>(
          `${base}/git/tags/${r.object.sha}`,
          token,
        );
        if (tag.object.type === "commit") return tag.object.sha;
      }
    } catch {
      /* try next */
    }
  }
  const commit = await ghJson<{ sha: string }>(
    `${base}/commits/${encodeURIComponent(ref)}`,
    token,
  );
  return commit.sha;
}

function isSkippedPath(p: string): boolean {
  const lower = p.toLowerCase();
  return (
    lower.includes("/node_modules/") ||
    lower.startsWith("node_modules/") ||
    lower.includes("/.git/") ||
    lower.includes("/dist/") ||
    lower.includes("/build/") ||
    lower.includes("/coverage/") ||
    lower.includes("/.next/") ||
    lower.includes("/vendor/") ||
    lower.endsWith(".lock") ||
    lower.endsWith(".min.js")
  );
}

function isTestPath(p: string): boolean {
  const n = p.toLowerCase();
  return (
    n.includes("__tests__") ||
    n.includes("/test/") ||
    n.includes("/tests/") ||
    n.includes("/__test__/") ||
    n.includes(".test.") ||
    n.includes(".spec.") ||
    n.endsWith("_test.py") ||
    n.endsWith("_test.go") ||
    n.includes("/e2e/") ||
    n.includes("/cypress/") ||
    n.includes("/playwright/")
  );
}

function isSourcePath(p: string): boolean {
  return /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|java|kt)$/i.test(p);
}

function basenameNoExt(p: string): string {
  const base = p.split("/").pop() ?? p;
  return base.replace(/\.[^/.]+$/, "");
}

function guessTestPathForSource(src: string): string | null {
  const dir = src.includes("/") ? src.slice(0, src.lastIndexOf("/")) : "";
  const base = basenameNoExt(src);
  const prefix = dir ? `${dir}/` : "";
  return `${prefix}${base}.test.ts`;
}

function hasMatchingTest(sourcePath: string, testFiles: string[]): boolean {
  const normSrc = sourcePath.replace(/\\/g, "/");
  const baseName = normSrc.split("/").pop() ?? normSrc;
  const stem = baseName.replace(/\.[^.]+$/, "");
  return testFiles.some((tf) => {
    const t = tf.replace(/\\/g, "/");
    const leaf = t.split("/").pop() ?? t;
    const looksLikeTest =
      t.includes(".test.") ||
      t.includes(".spec.") ||
      t.includes("__tests__") ||
      t.includes("/test/");
    if (!looksLikeTest) return false;
    const stemT = leaf.replace(/\.[^.]+$/, "");
    return stemT.includes(stem) || leaf.includes(`${stem}.`);
  });
}

/** npm package name → canonical runner id */
const RUNNER_PACKAGE_MAP: Record<string, string> = {
  vitest: "vitest",
  jest: "jest",
  "@jest/globals": "jest",
  mocha: "mocha",
  ava: "ava",
  tap: "tap",
  uvu: "uvu",
  "@playwright/test": "playwright",
  playwright: "playwright",
  cypress: "cypress",
  "@testing-library/react": "testing-library",
  "@testing-library/vue": "testing-library",
  "@testing-library/svelte": "testing-library",
  "@testing-library/dom": "testing-library",
  pytest: "pytest",
  "ts-jest": "jest",
  "babel-jest": "jest",
};

function collectDeclaredDeps(pkg: PackageJsonInfo): Record<string, string> {
  return { ...pkg.deps, ...pkg.devDeps, ...pkg.peerDeps };
}

function detectRunners(pkg: PackageJsonInfo): string[] {
  const declared = collectDeclaredDeps(pkg);
  const found = new Set<string>();
  for (const [name, _ver] of Object.entries(declared)) {
    const id = RUNNER_PACKAGE_MAP[name];
    if (id) found.add(id);
  }
  const testScript = (pkg.scripts.test ?? "").toLowerCase();
  if (testScript.includes("vitest")) found.add("vitest");
  if (testScript.includes("jest")) found.add("jest");
  if (testScript.includes("mocha")) found.add("mocha");
  if (testScript.includes("playwright")) found.add("playwright");
  if (testScript.includes("cypress")) found.add("cypress");
  if (testScript.includes("pytest") || testScript.includes("py.test"))
    found.add("pytest");
  return [...found];
}

function detectStackTags(
  pkg: PackageJsonInfo | null,
  allPaths: string[],
): string[] {
  const tags = new Set<string>();
  if (pkg) {
    const d = collectDeclaredDeps(pkg);
    if (d.react || d["react-dom"]) tags.add("react");
    if (d.next) tags.add("next");
    if (d.vue) tags.add("vue");
    if (d.svelte) tags.add("svelte");
    if (d.fastify || d.express || d["@nestjs/core"]) tags.add("node-service");
    if (d.pytest || d.django || d.flask) tags.add("python");
  }
  const pathStr = allPaths.join("\n").toLowerCase();
  if (pathStr.includes("go.mod") || allPaths.some((p) => p.endsWith(".go")))
    tags.add("go");
  if (allPaths.some((p) => /(^|\/)route\.(tsx|ts|js)$/i.test(p)))
    tags.add("app-router");
  if (allPaths.some((p) => p.includes("/pages/api/"))) tags.add("pages-api");
  return [...tags];
}

function parsePackageJson(content: string): PackageJsonInfo | null {
  try {
    const raw = JSON.parse(content) as Record<string, unknown>;
    const scripts = (raw.scripts as Record<string, string>) ?? {};
    const deps = (raw.dependencies as Record<string, string>) ?? {};
    const devDeps = (raw.devDependencies as Record<string, string>) ?? {};
    const peerDeps = (raw.peerDependencies as Record<string, string>) ?? {};
    return { raw, scripts, deps, devDeps, peerDeps };
  } catch {
    return null;
  }
}

function pathMatchesAny(path: string, globs: RegExp[]): boolean {
  const n = path.replace(/\\/g, "/");
  return globs.some((re) => re.test(n));
}

function hasTreeFile(paths: Set<string>, candidates: string[]): boolean {
  for (const c of candidates) {
    if (paths.has(c)) return true;
  }
  return [...paths].some((p) => candidates.some((c) => p.endsWith(`/${c}`)));
}

function inferPrimaryRunner(runners: string[]): string | undefined {
  const order = ["vitest", "jest", "mocha", "playwright", "pytest"];
  for (const o of order) {
    if (runners.includes(o)) return o;
  }
  return runners[0];
}

function sourceImportanceScore(path: string): number {
  const n = path.replace(/\\/g, "/").toLowerCase();
  let s = 0;
  if (n.includes("/utils/") || n.includes("/lib/")) s += 4;
  if (n.includes("/hooks/") || /\/use[A-Z][a-zA-Z]*\./.test(n)) s += 3;
  if (n.includes("/components/")) s += 3;
  if (/route\.(tsx?|jsx?|js)$/i.test(n) || n.includes("/api/")) s += 3;
  if (n.includes("/services/") || n.includes("/repository/")) s += 2;
  if (n.includes("/src/")) s += 1;
  if (/^[a-z]+$/i.test(basenameNoExt(n)) && n.endsWith(".ts")) s += 1;
  return s;
}

function guessExportedSymbol(path: string): string | undefined {
  const base = basenameNoExt(path);
  if (base.startsWith("use") && base.length > 3) return base;
  if (/^[A-Z]/.test(base)) return base;
  return undefined;
}

function isLikelyE2eTestPath(p: string): boolean {
  const n = p.toLowerCase();
  return (
    n.includes("/e2e/") ||
    n.includes("/playwright/") ||
    n.includes("/cypress/") ||
    n.includes(".e2e.") ||
    (n.endsWith(".spec.ts") && n.includes("e2e"))
  );
}

function buildSmartSuggestions(args: {
  sourceFiles: string[];
  testFiles: string[];
  allPaths: string[];
  packageJson: PackageJsonInfo | null;
  includePackageJson: boolean;
  focus: "all" | "source" | "tests";
}): {
  suggestions: Suggestion[];
  meta: z.infer<typeof GitHubRepoAnalyzeAnalysisMetaSchema>;
} {
  const {
    sourceFiles,
    testFiles,
    allPaths,
    packageJson,
    includePackageJson,
    focus,
  } = args;

  const pathSet = new Set(allPaths.map((p) => p.replace(/\\/g, "/")));
  const runners = packageJson ? detectRunners(packageJson) : [];
  const primary = inferPrimaryRunner(runners);
  const testScriptPresent = Boolean(
    packageJson?.scripts && packageJson.scripts.test,
  );
  const stackTags = detectStackTags(packageJson, allPaths);

  const heuristicNotes: string[] = [];

  const suggestions: Suggestion[] = [];

  const push = (
    s: Omit<Suggestion, "priority"> & { priority?: Priority },
  ) => {
    suggestions.push({
      priority: s.priority ?? "medium",
      category: s.category,
      file: s.file,
      function: s.function,
      description: s.description,
    });
  };

  if (includePackageJson && packageJson && !testScriptPresent) {
    push({
      category: "tooling",
      file: "package.json",
      description:
        "Add a `scripts.test` entry that runs your unit/integration suite (e.g. `vitest run`, `jest`, `playwright test`).",
      priority: "high",
    });
    heuristicNotes.push("No `scripts.test` in package.json.");
  }

  if (
    packageJson &&
    runners.includes("vitest") &&
    !hasTreeFile(pathSet, [
      "vitest.config.ts",
      "vitest.config.mts",
      "vitest.config.js",
      "vitest.config.mjs",
    ]) &&
    ![...pathSet].some((p) => p.includes("vite.config") && p.endsWith(".ts"))
  ) {
    push({
      category: "framework-setup",
      file: "(repository)",
      function: undefined,
      description:
        "Vitest appears in dependencies but no `vitest.config.*` was found; add explicit config (pool, environment, coverage thresholds).",
      priority: "medium",
    });
    heuristicNotes.push("Vitest dependency without an obvious vitest config file.");
  }

  if (
    packageJson &&
    runners.includes("jest") &&
    !hasTreeFile(pathSet, [
      "jest.config.js",
      "jest.config.ts",
      "jest.config.mjs",
      "jest.config.cjs",
    ])
  ) {
    push({
      category: "framework-setup",
      file: "(repository)",
      description:
        "Jest is referenced but no `jest.config.*` found at repo root; centralize transform/module resolution for CI parity.",
      priority: "medium",
    });
  }

  const e2eDep =
    packageJson &&
    (collectDeclaredDeps(packageJson)["@playwright/test"] ||
      collectDeclaredDeps(packageJson).cypress);

  const hasE2eTests = testFiles.some(isLikelyE2eTestPath);
  if (e2eDep && !hasE2eTests && focus !== "tests") {
    push({
      category: "e2e-gap",
      file: "(repository)",
      description:
        "E2E runner present (@playwright/test or cypress) but no obvious `e2e/`, `cypress/`, or `*.e2e.*` tests in the tree — add smoke flows for critical paths.",
      priority: "high",
    });
    heuristicNotes.push("E2E dependency without matching test paths in tree.");
  }

  if (
    packageJson &&
    stackTags.includes("react") &&
    runners.includes("testing-library") &&
    sourceFiles.some((p) =>
      /\/components\/.*\.(tsx|jsx)$/i.test(p.replace(/\\/g, "/")),
    )
  ) {
    const componentSources = sourceFiles.filter((p) =>
      /\/components\/.*\.(tsx|jsx)$/i.test(p.replace(/\\/g, "/")),
    );
    const untested = componentSources.filter(
      (p) => !hasMatchingTest(p, testFiles),
    );
    const sample = untested.slice(0, 5);
    for (const file of sample) {
      const sym = guessExportedSymbol(file);
      push({
        category: "component-test",
        file,
        function: sym,
        description: `Add a Testing Library spec for this component (render, user events, a11y).${primary ? ` Prefer ${primary} as the runner.` : ""}`,
        priority: "medium",
      });
    }
    if (untested.length > sample.length) {
      heuristicNotes.push(
        `${untested.length - sample.length} more component files may lack tests.`,
      );
    }
  }

  /** Next / app-router API routes */
  const apiLike = sourceFiles.filter((p) =>
    pathMatchesAny(p, [
      /(^|\/)route\.(tsx?|jsx?|js)$/i,
      /\/pages\/api\/[^/]+\.(tsx?|js)$/i,
    ]),
  );
  for (const file of apiLike.slice(0, 8)) {
    if (!hasMatchingTest(file, testFiles)) {
      push({
        category: "api-gap",
        file,
        description:
          "HTTP handler without an obvious colocated or mirrored test — add contract tests (status, JSON shape, auth paths).",
        priority: "high",
      });
    }
  }

  /** Rank sources for coverage gaps */
  const ranked = [...sourceFiles]
    .map((p) => ({ p, score: sourceImportanceScore(p) }))
    .sort((a, b) => b.score - a.score);

  const maxGapSuggestions = 80;
  let gapCount = 0;
  for (const { p: norm } of ranked) {
    if (gapCount >= maxGapSuggestions) break;
    if (!isSourcePath(norm) || isTestPath(norm)) continue;
    if (!hasMatchingTest(norm, testFiles)) {
      const suggestedPath = guessTestPathForSource(norm);
      const sym = guessExportedSymbol(norm);
      const runnerHint = primary
        ? ` Use ${primary} to mirror existing tooling.`
        : "";
      push({
        category: "coverage-gap",
        file: norm,
        function: sym,
        description: `No matching test file found for "${norm}". Add tests near ${suggestedPath ?? "*.test.*"} covering edge cases and errors.${runnerHint}`,
        priority: norm.includes("/utils/") || norm.includes("/lib/")
          ? "high"
          : "medium",
      });
      gapCount += 1;
    }
  }

  if (testFiles.length === 0 && sourceFiles.length > 0 && focus !== "tests") {
    push({
      category: "integration",
      file: "(repository)",
      description:
        "No test-like paths detected; bootstrap a runner and add smoke tests for core modules and public API.",
      priority: "high",
    });
  }

  /** Python: pytest heuristic */
  if (
    packageJson &&
    (runners.includes("pytest") || stackTags.includes("python")) &&
    sourceFiles.some((f) => f.endsWith(".py")) &&
    testFiles.filter((f) => f.includes("test_") || f.endsWith("_test.py"))
      .length === 0
  ) {
    push({
      category: "python-suite",
      file: "(repository)",
      description:
        "Python sources present but no `test_*.py` / `*_test.py` files found — add pytest modules alongside packages.",
      priority: "high",
    });
  }

  /** Go: *_test.go pair heuristic */
  const goSources = sourceFiles.filter(
    (f) => f.endsWith(".go") && !/_test\.go$/i.test(f),
  );
  if (goSources.length > 0) {
    let missingPair = 0;
    for (const gs of goSources.slice(0, 60)) {
      const dir = gs.includes("/") ? gs.slice(0, gs.lastIndexOf("/")) : "";
      const base = basenameNoExt(gs);
      const cand = dir ? `${dir}/${base}_test.go` : `${base}_test.go`;
      if (!pathSet.has(cand.replace(/\\/g, "/"))) missingPair += 1;
    }
    if (missingPair > 0 && testFiles.every((t) => !t.endsWith("_test.go"))) {
      push({
        category: "go-test-pair",
        file: goSources[0] ?? "(repository)",
        description:
          "Go sources found without matching `_test.go` files in tree — add table-driven tests next to packages.",
        priority: "medium",
      });
    }
  }

  /** Dedupe by category+file+description */
  const seen = new Set<string>();
  const deduped: Suggestion[] = [];
  for (const s of suggestions) {
    const key = `${s.category}|${s.file}|${s.description.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }

  const priorityOrder: Record<Priority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  deduped.sort(
    (a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      a.file.localeCompare(b.file),
  );

  const meta = {
    packageJsonFound: Boolean(packageJson),
    testScriptPresent,
    detectedRunners: runners,
    stackTags,
    heuristicNotes:
      heuristicNotes.length > 0 ? heuristicNotes.slice(0, 12) : undefined,
  };

  return {
    suggestions: deduped.slice(0, 100),
    meta,
  };
}

export const githubRepoAnalyzeNode: NodeDefinition = {
  type: "github.repo.analyze",
  label: "GitHub repo analyze",
  category: "action",
  description:
    "Inspect a GitHub repository tree via the REST API and suggest tests using rule-based heuristics (no AI).",
  configSchema:
    GitHubRepoAnalyzeConfigSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  outputSchema:
    GitHubRepoAnalyzeOutputSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  execute: async ({ config, context, inputData }) => {
    const c = GitHubRepoAnalyzeConfigSchema.parse(config);
    const upstream = (inputData ?? {}) as Record<string, unknown>;
    const token = resolveGithubToken(c.githubToken, upstream);
    const slug = `${c.owner}/${c.repo}`;

    context.logger.info("GitHub analyze", { slug, ref: c.ref });

    const repo = await ghJson<Record<string, unknown>>(
      `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`,
      token,
    );

    const commitSha = await resolveCommitSha(
      c.owner,
      c.repo,
      c.ref,
      token,
    );

    const commit = await ghJson<{ tree: { sha: string } }>(
      `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/git/commits/${commitSha}`,
      token,
    );

    const tree = await ghJson<{ tree: TreeNode[]; truncated?: boolean }>(
      `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/git/trees/${commit.tree.sha}?recursive=1`,
      token,
    );

    const allPaths = (tree.tree ?? [])
      .filter((n) => n.type === "blob" && n.path)
      .map((n) => n.path as string)
      .filter((p) => !isSkippedPath(p));

    let sourceFiles = allPaths.filter(
      (p) => isSourcePath(p) && !isTestPath(p),
    );
    let testFiles = allPaths.filter(isTestPath);

    if (c.focus === "source") {
      testFiles = [];
    } else if (c.focus === "tests") {
      sourceFiles = [];
    }

    const extCounts = new Map<string, number>();
    for (const p of allPaths) {
      const m = p.match(/\.([^.]+)$/);
      const ext = m?.[1]?.toLowerCase() ?? "(no-ext)";
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
    }
    const topExtensions = [...extCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([ext, count]) => ({ ext, count }));

    let packageJson: PackageJsonInfo | null = null;
    if (c.includePackageJson) {
      try {
        const pkgRaw = await ghJson<{ content?: string; encoding?: string }>(
          `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/package.json?ref=${encodeURIComponent(commitSha)}`,
          token,
        );
        if (pkgRaw.content && pkgRaw.encoding === "base64") {
          const decoded = Buffer.from(pkgRaw.content, "base64").toString("utf8");
          packageJson = parsePackageJson(decoded);
        }
      } catch {
        packageJson = null;
      }
    }

    const { suggestions: suggestedTestCases, meta: analysisMeta } =
      buildSmartSuggestions({
        sourceFiles,
        testFiles,
        allPaths,
        packageJson,
        includePackageJson: c.includePackageJson,
        focus: c.focus,
      });

    const fileTreeSummary = {
      totalFiles: allPaths.length,
      topExtensions,
      truncated: Boolean(tree.truncated),
    };

    const suggestionCount = suggestedTestCases.length;
    const sourceFilesOut = sourceFiles.slice(0, OUTPUT_MAX_SOURCE_FILES);
    const testFilesOut = testFiles.slice(0, OUTPUT_MAX_TEST_FILES);
    const suggestedOut = suggestedTestCases.slice(0, OUTPUT_MAX_SUGGESTIONS);

    const output = {
      repo: pickRepoSummary(repo),
      fileTreeSummary,
      sourceFiles: sourceFilesOut,
      sourceFilesTotal: sourceFiles.length,
      sourceFilesTruncated: sourceFiles.length > OUTPUT_MAX_SOURCE_FILES,
      testFiles: testFilesOut,
      testFilesTotal: testFiles.length,
      testFilesTruncated: testFiles.length > OUTPUT_MAX_TEST_FILES,
      suggestedTestCases: suggestedOut,
      suggestedTestCasesTruncated:
        suggestedTestCases.length > OUTPUT_MAX_SUGGESTIONS,
      analysisMeta,
      gitOwner: c.owner,
      gitRepo: c.repo,
      gitRef: c.ref,
      suggestionCount,
      ...(token ? { githubToken: token } : {}),
    };

    GitHubRepoAnalyzeOutputSchema.parse(output);

    return output;
  },
};
