import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { NodeDefinition } from "@wfengine/core";
import { z } from "zod";
import {
  GitHubRepoRunTestsConfigSchema,
  GitHubRepoRunTestsOutputSchema,
  TestFileResultSchema,
  type FailedTestDetailSchema,
  type SingleTestResultSchema,
} from "../../config-schemas.js";
import { resolveGithubRepoContext } from "./github-repo-context.js";
import { resolveGithubToken } from "./github-token-resolve.js";

export {
  GitHubRepoRunTestsConfigSchema,
  GitHubRepoRunTestsOutputSchema,
} from "../../config-schemas.js";

const execAsync = promisify(exec);

type WorkflowLoggerLike = { info: (m: string, ctx?: Record<string, unknown>) => void };

/**
 * Materialize tests from upstream `github.repo.generate-tests-llm` before npm test.
 */
function writeGeneratedTestFiles(
  cwd: string,
  files: unknown,
  logger: WorkflowLoggerLike,
): number {
  if (!Array.isArray(files) || files.length === 0) return 0;
  const root = resolve(cwd);
  let n = 0;
  for (const raw of files) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const relRaw =
      typeof o.relativePath === "string"
        ? o.relativePath
        : typeof o.path === "string"
          ? o.path
          : "";
    const content = typeof o.content === "string" ? o.content : "";
    const norm = relRaw.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (!norm || norm.includes("..")) continue;
    const target = resolve(join(root, norm));
    const relCheck = relative(root, target);
    if (
      relCheck.startsWith(`..${sep}`) ||
      relCheck === ".." ||
      relCheck.startsWith("../")
    ) {
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
    n += 1;
  }
  if (n > 0) {
    logger.info("repo-run-tests: wrote generated test files", { count: n });
  }
  return n;
}

function runShellCommand(
  fullCommand: string,
  opts: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const child = spawn(fullCommand, {
      cwd: opts.cwd,
      env: opts.env,
      shell: true,
    });
    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Test command timeout after ${opts.timeout}ms`));
    }, opts.timeout);
    let total = 0;
    child.stdout?.on("data", (d) => {
      out.push(d);
      total += d.length;
      if (total > opts.maxBuffer) {
        child.kill("SIGKILL");
      }
    });
    child.stderr?.on("data", (d) => {
      err.push(d);
      total += d.length;
      if (total > opts.maxBuffer) {
        child.kill("SIGKILL");
      }
    });
    child.on("error", (e) => {
      clearTimeout(killTimer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

function runSpawn(
  command: string,
  args: string[],
  opts: { cwd: string; timeout: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Spawn timeout after ${opts.timeout}ms`));
    }, opts.timeout);
    child.stdout?.on("data", (d) => out.push(d));
    child.stderr?.on("data", (d) => err.push(d));
    child.on("error", (e) => {
      clearTimeout(killTimer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

type FailedDetail = z.infer<typeof FailedTestDetailSchema>;
type SingleTest = z.infer<typeof SingleTestResultSchema>;
type FileBlock = z.infer<typeof TestFileResultSchema>;

/** Resolve `subpath` under `root` and reject traversal outside `root`. */
function resolveRepoSubpath(root: string, subpath: string): string {
  const raw = subpath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!raw) return root;
  if (raw.includes("..") || raw.includes("\0")) {
    throw new Error("github.repo.run-tests: repoSubpath must not contain '..' or control characters.");
  }
  const abs = resolve(root, raw);
  const rel = relative(root, abs);
  if (
    rel.startsWith(`..${sep}`) ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("/")
  ) {
    throw new Error("github.repo.run-tests: repoSubpath must stay inside the repository root.");
  }
  return abs;
}

function cloneUrl(
  owner: string,
  repo: string,
  token: string | undefined,
): string {
  const base = `github.com/${owner}/${repo}.git`;
  if (token) {
    return `https://x-access-token:${token.replace(/@/g, "%40")}@${base}`;
  }
  return `https://${base}`;
}

function parseTotals(combined: string): {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
} {
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const jestLike =
    combined.match(
      /Tests:\s*(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(\d+)\s+passed(?:,\s*(\d+)\s+total)?/i,
    ) ||
    combined.match(/Tests:\s*(\d+)\s+passed,\s*(\d+)\s+failed,\s*(\d+)\s+total/i);

  if (jestLike) {
    if (jestLike.length >= 5 && jestLike[4]) {
      failed = Number(jestLike[1] ?? 0);
      skipped = Number(jestLike[2] ?? 0);
      passed = Number(jestLike[3] ?? 0);
      const tot = jestLike[4] ? Number(jestLike[4]) : passed + failed + skipped;
      return { passed, failed, skipped, total: tot };
    }
    if (jestLike.length >= 4 && jestLike[1] && jestLike[2] && jestLike[3]) {
      passed = Number(jestLike[1]);
      failed = Number(jestLike[2]);
      const total = Number(jestLike[3]);
      skipped = Math.max(0, total - passed - failed);
      return { passed, failed, skipped, total };
    }
  }

  const vitest =
    combined.match(/Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed\s*\((\d+)\)/i) ||
    combined.match(/Tests\s+(\d+)\s+passed\s*\((\d+)\)/i);

  if (vitest) {
    if (vitest.length >= 4 && vitest[3]) {
      failed = Number(vitest[1] ?? 0);
      passed = Number(vitest[2] ?? 0);
      const total = Number(vitest[3] ?? 0);
      skipped = Math.max(0, total - passed - failed);
      return { passed, failed, skipped, total };
    }
    if (vitest.length >= 3 && vitest[2]) {
      passed = Number(vitest[1] ?? 0);
      const total = Number(vitest[2] ?? 0);
      return { passed, failed: 0, skipped: 0, total };
    }
  }

  const tapLike = combined.match(/(\d+)\s+pass(?:ing)?/i);
  const failLike = combined.match(/(\d+)\s+fail(?:ing)?/i);
  if (tapLike || failLike) {
    passed = tapLike ? Number(tapLike[1]) : 0;
    failed = failLike ? Number(failLike[1]) : 0;
    return {
      passed,
      failed,
      skipped: 0,
      total: passed + failed,
    };
  }

  return { passed: 0, failed: 0, skipped: 0, total: 0 };
}

function parseFailedBlocks(combined: string): FailedDetail[] {
  const out: FailedDetail[] = [];
  const lines = combined.split("\n");
  let currentFile = "_unknown";

  for (const line of lines) {
    const fm = line.match(
      /^\s*(?:FAIL|FAILURES?)\s+([^\s]+\.(?:test|spec)\.[jt]sx?)/i,
    );
    if (fm?.[1]) currentFile = fm[1].trim();

    const bullet = line.match(
      /^\s*(?:✕|×|✖)\s+(.+?)\s*$/u,
    );
    if (bullet?.[1]) {
      out.push({ testFile: currentFile, name: bullet[1].trim() });
      continue;
    }

    const jestFail = line.match(/^\s*●\s+(.+)$/);
    if (jestFail?.[1]) {
      out.push({ testFile: currentFile, name: jestFail[1].trim() });
    }
  }

  return out.slice(0, 200);
}

function tryParseVitestJsonReport(
  combined: string,
): { files: FileBlock[]; failed: FailedDetail[] } | null {
  const blocks: FileBlock[] = [];
  const failed: FailedDetail[] = [];

  const lines = combined.split("\n").filter((l) => l.trim().startsWith("{"));
  for (const line of lines.slice(-80)) {
    try {
      const j = JSON.parse(line) as {
        testResults?: Array<{
          name?: string;
          assertionResults?: Array<{
            title?: string;
            status?: string;
            duration?: number;
            failureMessages?: string[];
          }>;
        }>;
      };
      const tr = j.testResults;
      if (!Array.isArray(tr)) continue;

      for (const suite of tr) {
        const testFile = suite.name ?? "unknown";
        const tests: SingleTest[] = [];
        let p = 0;
        let f = 0;
        for (const ar of suite.assertionResults ?? []) {
          const statusRaw = (ar.status ?? "failed").toLowerCase();
          const status =
            statusRaw === "passed"
              ? "passed"
              : statusRaw === "pending"
                ? "pending"
                : statusRaw === "skipped"
                  ? "skipped"
                  : "failed";
          if (status === "passed") p += 1;
          else if (status === "failed") f += 1;
          const st: SingleTest = {
            name: ar.title ?? "(anonymous)",
            status,
            duration:
              ar.duration !== undefined ? `${(ar.duration / 1000).toFixed(2)}s` : undefined,
            error: ar.failureMessages?.join("\n")?.slice(0, 2000),
          };
          tests.push(st);
          if (status === "failed") {
            failed.push({
              testFile,
              name: st.name,
              error: st.error,
            });
          }
        }
        blocks.push({
          testFile,
          passed: p,
          failed: f,
          tests,
        });
      }

      if (blocks.length) return { files: blocks, failed };
    } catch {
      /* next line */
    }
  }
  return null;
}

function buildAggregateResult(
  combined: string,
  exitCode: number,
  durationMs: number,
  slug: string,
  ref: string,
  testCommand: string,
): z.infer<typeof GitHubRepoRunTestsOutputSchema> {
  const parsed = tryParseVitestJsonReport(combined);
  let totals = parseTotals(combined);

  let testResults: FileBlock[] = [];
  let failedTests: FailedDetail[] = [];

  if (parsed) {
    testResults = parsed.files;
    failedTests = parsed.failed;
    let p = 0;
    let f = 0;
    let s = 0;
    for (const file of testResults) {
      for (const t of file.tests) {
        if (t.status === "passed") p += 1;
        else if (t.status === "failed") f += 1;
        else if (t.status === "skipped") s += 1;
      }
    }
    totals = {
      passed: p,
      failed: f,
      skipped: s,
      total: p + f + s,
    };
  } else {
    failedTests = parseFailedBlocks(combined);
    if (totals.total === 0 && totals.passed === 0 && totals.failed === 0) {
      totals = {
        passed: 0,
        failed: exitCode === 0 ? 0 : 1,
        skipped: 0,
        total: exitCode === 0 ? 0 : 1,
      };
    }

    testResults = [
      {
        testFile: "_summary",
        passed: totals.passed,
        failed: totals.failed,
        tests:
          failedTests.length > 0
            ? failedTests.map((ft) => ({
                name: ft.name,
                status: "failed" as const,
                error: ft.error,
              }))
            : [],
      },
    ];
  }

  const totalTests = Math.max(
    totals.total,
    totals.passed + totals.failed + totals.skipped,
  );
  const passRate =
    totalTests > 0 ? Math.round((totals.passed / totalTests) * 10000) / 100 : 0;

  const summary = `${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped`;

  const success = exitCode === 0;

  return {
    success,
    repo: slug,
    ref,
    testCommand,
    totalTests,
    passed: totals.passed,
    failed: totals.failed,
    skipped: totals.skipped,
    duration: `${(durationMs / 1000).toFixed(1)}s`,
    passRate,
    summary,
    testResults,
    failedTests,
    rawLogExcerpt: combined.slice(-6000),
    exitCode,
  };
}

export const githubRepoRunTestsNode: NodeDefinition = {
  type: "github.repo.run-tests",
  label: "GitHub repo run tests",
  category: "action",
  description:
    "Clone a GitHub repo (or use a local path), install deps, run the test command, return structured results. For monorepos, set **repoSubpath** to the package directory (where `package.json` lives). Omit **owner**/**repo**/**ref** when upstream provides `git*` or `repoInfo`.",
  configSchema:
    GitHubRepoRunTestsConfigSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  outputSchema:
    GitHubRepoRunTestsOutputSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  execute: async ({ config, inputData, context }) => {
    const c = GitHubRepoRunTestsConfigSchema.parse(config);
    const upstream = inputData as Record<string, unknown>;
    const ghToken = resolveGithubToken(c.githubToken, upstream);
    const { owner, repo, ref } = resolveGithubRepoContext(
      { owner: c.owner, repo: c.repo, ref: c.ref },
      upstream,
      "main",
    );

    const wd = c.workingDirectory?.trim();
    if (!wd && (!owner || !repo)) {
      throw new Error(
        "github.repo.run-tests: configure `owner` and `repo`, or connect this node after `github.repo.analyze`, or set `workingDirectory` to a local clone.",
      );
    }

    const slug =
      owner && repo
        ? `${owner}/${repo}`
        : wd
          ? `local:${basename(wd)}`
          : "unknown";

    const subRaw = c.repoSubpath?.trim() ?? "";
    let repoRoot: string;
    let cleanupDir: string | null = null;

    if (wd) {
      if (!existsSync(wd)) {
        throw new Error(`workingDirectory does not exist: ${wd}`);
      }
      repoRoot = resolve(wd);
      context.logger.info("Run tests using local directory", { repoRoot });
    } else {
      const dest = mkdtempSync(join(tmpdir(), "wfengine-gh-test-"));
      cleanupDir = dest;
      repoRoot = dest;
      const url = cloneUrl(owner, repo, ghToken);
      context.logger.info("Cloning repository", { slug, ref });
      const cloneRes = await runSpawn(
        "git",
        ["clone", "--depth", "1", "--branch", ref, url, "."],
        { cwd: dest, timeout: 120_000 },
      );
      if (cloneRes.code !== 0) {
        throw new Error(
          `git clone failed: ${cloneRes.stderr.slice(0, 800) || cloneRes.stdout.slice(0, 800)}`,
        );
      }
    }

    const runCwd = subRaw ? resolveRepoSubpath(repoRoot, subRaw) : repoRoot;
    if (!existsSync(join(runCwd, "package.json"))) {
      throw new Error(
        subRaw
          ? `github.repo.run-tests: no package.json under repoSubpath "${subRaw}" (resolved to ${runCwd}). Check the path.`
          : `github.repo.run-tests: no package.json at repository root (${repoRoot}). For monorepos, set **repoSubpath** to the package folder that contains package.json (e.g. web_monitor_api).`,
      );
    }

    try {
      if (existsSync(join(runCwd, "package-lock.json"))) {
        await execAsync("npm ci", {
          cwd: runCwd,
          timeout: Math.min(180_000, Math.floor(c.timeout / 3)),
          maxBuffer: 20 * 1024 * 1024,
          env: { ...process.env, CI: "true" },
        });
      } else {
        await execAsync("npm install", {
          cwd: runCwd,
          timeout: Math.min(180_000, Math.floor(c.timeout / 3)),
          maxBuffer: 20 * 1024 * 1024,
          env: { ...process.env, CI: "true" },
        });
      }
    } catch (e) {
      context.logger.warn("npm ci/install failed; continuing to tests", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    writeGeneratedTestFiles(repoRoot, upstream.generatedTestFiles, context.logger);

    const started = Date.now();
    let combined = "";
    let exitCode = 1;

    const testRes = await runShellCommand(c.testCommand, {
      cwd: runCwd,
      timeout: c.timeout,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        CI: "true",
        FORCE_COLOR: "0",
      },
    });
    combined = `${testRes.stdout}\n${testRes.stderr}`;
    exitCode = testRes.code;

    const durationMs = Date.now() - started;

    try {
      const reportPath = join(runCwd, ".wfengine-jest.json");
      if (existsSync(reportPath)) {
        const raw = readFileSync(reportPath, "utf8");
        const j = JSON.parse(raw) as {
          testResults?: Array<{
            name: string;
            assertionResults?: Array<{
              title: string;
              status: string;
              failureMessages?: string[];
            }>;
          }>;
        };
        if (j.testResults?.length) {
          const fakeCombined = JSON.stringify({
            testResults: j.testResults.map((r) => ({
              name: r.name,
              assertionResults: r.assertionResults,
            })),
          });
          combined = `${fakeCombined}\n${combined}`;
        }
      }
    } catch {
      /* optional jest json */
    }

    const out = buildAggregateResult(
      combined,
      exitCode,
      durationMs,
      slug,
      ref,
      c.testCommand,
    );

    GitHubRepoRunTestsOutputSchema.parse(out);

    if (cleanupDir) {
      try {
        rmSync(cleanupDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }

    return out;
  },
};
