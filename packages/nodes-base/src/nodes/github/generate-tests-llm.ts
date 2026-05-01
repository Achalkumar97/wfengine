import { z } from "zod";
import {
  GeneratedTestFileEntrySchema,
  GeneratedTestSummaryEntrySchema,
} from "../../config-schemas.js";

/** Hard cap on total bytes of generated test source emitted to disk. */
export const MAX_TOTAL_GENERATED_BYTES = 512 * 1024;

/** Max number of test files taken from the model response. */
export const MAX_OUTPUT_FILES = 12;

/** Max rows in `generatedTestSummary` from the model. */
export const MAX_SUMMARY_ROWS = 25;

/** Model temperature is capped at 0.2 for steadier, more deterministic tests. */
export const LLM_TEMPERATURE_CAP = 0.2;

export const LlmResponseSchema = z.object({
  files: z.array(GeneratedTestFileEntrySchema).optional().default([]),
  generatedTestSummary: z
    .array(GeneratedTestSummaryEntrySchema)
    .optional()
    .default([]),
});

function scorePathForTestPriority(p: string): number {
  const n = p.replace(/\\/g, "/");
  const lower = n.toLowerCase();
  const leaf = lower.split("/").pop() ?? lower;
  let s = 100;

  if (leaf === "__init__.py") return -999;
  if (lower.endsWith("/__init__.py")) s -= 120;
  if (/\/dto\//.test(lower) || /\.dto\.(ts|tsx|js|jsx)$/.test(leaf)) s -= 95;
  if (/\/entities\//.test(lower) || /\.entity\.(ts|tsx|js|jsx)$/.test(leaf))
    s -= 90;
  if (/\/migrations\//.test(lower) || /\/migration\//.test(lower)) s -= 100;
  if (
    /\/config\//.test(lower) ||
    /^config\.(ts|js|mjs|cjs)$/.test(leaf) ||
    /\.config\.(ts|js|mjs|cjs)$/.test(leaf)
  )
    s -= 75;
  if (/\/seed/.test(lower) || /seed-cli/.test(leaf)) s -= 65;
  if (/\/constants?\//.test(lower)) s -= 40;
  if (/\/schemas?\//.test(lower)) s -= 30;
  if (/\/models?\//.test(lower)) s -= 35;
  if (/\/types?\//.test(lower) && /\.(ts|tsx)$/.test(leaf)) s -= 45;
  if (/\/pipes?\//.test(lower)) s -= 25;
  if (/\/filters?\//.test(lower) && /\.filter\.(ts|tsx)$/.test(leaf)) s -= 15;
  if (leaf.endsWith(".module.ts") || leaf.endsWith(".module.js")) s -= 45;

  if (/\/services?\//.test(lower)) s += 58;
  if (/\/utils?\//.test(lower)) s += 45;
  if (/\/engines?\//.test(lower) || /\/engine\//.test(lower)) s += 55;
  if (/\/managers?\//.test(lower)) s += 52;
  if (/\/repositor(y|ies)\//.test(lower)) s += 42;
  if (/\/crawl_engine\//.test(lower) || /\/capture_engines\//.test(lower))
    s += 50;
  if (/\/comparison\//.test(lower)) s += 42;
  if (/\/url_processing_engine\//.test(lower)) s += 46;
  if (/\/core\//.test(lower) && !/\/core\/config/.test(lower)) s += 38;
  if (/\/core\/config/.test(lower)) s -= 55;
  if (/\/controllers?\//.test(lower)) s += 32;
  if (/\/providers?\//.test(lower)) s += 25;
  if (/\/spiders?\//.test(lower)) s += 34;
  if (/\/tasks?\//.test(lower)) s += 28;
  if (/\/crawl-jobs\//.test(lower) && /service\.(ts|js)$/.test(leaf)) s += 40;

  if (/(^|\/)([^/]*_service|[^/]*service)\.(py|ts|js|tsx)$/.test(lower))
    s += 28;
  if (/(^|\/)([^/]*_manager|[^/]*manager)\.(py|ts|js|tsx)$/.test(lower))
    s += 24;
  if (/(^|\/)([^/]*_engine|[^/]*engine)\.(py|ts|js|tsx)$/.test(lower)) s += 24;
  if (/\.controller\.(ts|js)$/.test(leaf)) s += 22;

  const depth = n.split("/").length;
  s += Math.min(depth, 12) * 2;

  return s;
}

/**
 * Order candidate source paths so high-value modules (services, engines, …)
 * are sent to the LLM first; deprioritize package stubs, DTOs, entities, migrations.
 */
export function rankSourcePathsForTestGeneration(paths: string[]): string[] {
  const scored = paths.map((p) => ({
    p,
    score: scorePathForTestPriority(p),
    leaf: p.replace(/\\/g, "/").split("/").pop() ?? p,
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.leaf.localeCompare(b.leaf);
  });
  return scored.map((x) => x.p);
}

function buildJsonContractForPrompt(): string {
  return [
    "Return **ONLY** valid JSON (no markdown fences, no commentary). The root object must have exactly these keys:",
    '  "files": [ { "relativePath": "string", "content": "string" } ],',
    '  "generatedTestSummary": [ { "sourceFile": "string", "testFile": "string (optional)", "description": "string" } ]',
    "",
    "Rules for `files`:",
    "- `relativePath` is repo-relative with forward slashes (e.g. `web_crawler/pkg/test_foo.py` or `web_monitor_api/src/foo.spec.ts`).",
    "- `content` is the full test module source as a single JSON string (escape newlines per JSON).",
    "",
    "Rules for `generatedTestSummary`:",
    "- One row per generated test file when possible; `sourceFile` must be a path that appeared in the user message.",
    "- `testFile` should match the `relativePath` of the corresponding entry in `files` when you can pair them.",
    "- `description`: 1–3 sentences listing what is tested: happy path, important edge cases, and error/exception behavior.",
  ].join("\n");
}

export function buildGenerateTestsSystemPrompt(
  framework: "jest" | "vitest" | "pytest",
  maxOutputFiles: number,
): string {
  const jsonContract = buildJsonContractForPrompt();

  if (framework === "pytest") {
    return [
      "You are a staff-level Python engineer writing **high-quality pytest** unit and integration-style tests for production code.",
      "",
      "## Read the code first",
      "For each file the user pastes: map **real** package imports (e.g. `from web_crawler.x import y`) — do **not** invent top-level packages like `core` unless the source file actually imports that way. Match the repository’s layout and sys.path / package structure implied by existing imports.",
      "",
      "## Pytest style (strict)",
      "- Test modules: `test_*.py` or `*_test.py` under `tests/` or next to packages; **function names** `test_*` only.",
      "- Prefer **@pytest.fixture** for shared setup; avoid module-level mutable singletons and `global` for instances under test.",
      "- Use **pytest.mark.parametrize** for similar cases; **pytest.mark.asyncio** for async tests; **pytest.raises** for expected failures.",
      "- Mock I/O: **unittest.mock.patch**, **AsyncMock** for async, or **monkeypatch** for env; **no real network/DB/S3**.",
      "- Assert on **observable behavior** (return values, raised exceptions, mock call_args), not private attributes unless unavoidable.",
      "",
      "## What to cover in every module (when the source allows it)",
      "1) **Happy path** — the main success path with realistic inputs.",
      "2) **Edge cases** — empty/None, boundary values, empty lists, max length, optional branches.",
      "3) **Errors** — invalid input, failure from a dependency, timeout/HTTP error when those paths exist in code.",
      "",
      "## Code quality in tests",
      "- **Meaningful test names**: `test_<behavior>_<condition>_<expected>`.",
      "- **Comments**: file-level docstring or block comment summarizing the target module; short comment before each `test_*` if the scenario is non-obvious.",
      "- Keep tests **fast and deterministic**; one logical behavior per test when practical.",
      "",
      jsonContract,
      "",
      "Output limits:",
      `- At most ${maxOutputFiles} objects in the \`files\` array.`,
      "- `generatedTestSummary` must align with the files you emit.",
      "- Do not embed full application source in `content` — only new test code.",
    ].join("\n");
  }

  return buildTypeScriptNodeJestVitestSystemPrompt(framework, maxOutputFiles, jsonContract);
}

/**
 * TypeScript: Jest or Vitest, with NestJS-style coverage when paths suggest it.
 */
function buildTypeScriptNodeJestVitestSystemPrompt(
  framework: "jest" | "vitest",
  maxOutputFiles: number,
  jsonContract: string,
): string {
  const runner = framework === "vitest" ? "Vitest" : "Jest";
  const mockApi =
    framework === "vitest"
      ? "Use `vi.mock`, `vi.spyOn`, `vi.fn`, `vi.stubGlobal`, and `vi.mocked`. Follow Vitest hoisting rules for `vi.mock`."
      : "Use `jest.mock`, `jest.spyOn`, `jest.fn`, `jest.mocked`, and `jest.useFakeTimers` when needed. Clear mock state in `afterEach` if shared.";

  return [
    `You are a staff-level engineer writing **${runner}** tests for real TypeScript/Node codebases. Prefer strict types in test files when the app uses TypeScript strictly.`,
    "",
    "## 1. Understand the module",
    "For each source file in the user message:",
    "- List **exports** to test: functions, classes, `const` factories, default export, and re-exports. Skip type-only exports at runtime.",
    "- Infer **valid and invalid inputs** from types, DTOs, and validation logic in the file.",
    "- Split **pure logic** from **I/O**; mock HTTP (`fetch`, clients), `fs`, DB, environment, and timers at boundaries.",
    "",
    "## 2. Structure and naming",
    "- Use `describe` / `it` (or `test`) with **descriptive names**: `it('returns … when …', …)`.",
    "- Group by **class** or **public function**; nest `describe` for distinct behaviors (success vs validation vs I/O failure).",
    "- **Async**: `async` `it` + `await`; use `expect(rejects).to…` or `rejects.toThrow` for expected failures.",
    "",
    "## 3. React / client components (`.tsx` with UI)",
    "- Use **@testing-library/react** (`render`, `screen`, `userEvent` or `fireEvent`); query by **role/label** over fragile CSS.",
    "- Cover: default render, key user paths, error/empty states, and accessibility-relevant output where obvious.",
    "",
    "## 4. NestJS-style code (when paths look like `*.controller.ts`, `*.service.ts`, `*.module.ts`, or use `@Injectable`, `@Controller`, etc.)",
    "- For **services**: test public methods; mock repository/clients with tokens or class mocks.",
    "- For **controllers**: use `Test.createTestingModule` from `@nestjs/testing` when a full request flow is too heavy, **or** unit-test handler methods with mocked service dependencies via `get` / `overrideProvider` on a lightweight module.",
    "- For **guards / pipes / interceptors**: table-drive several request contexts; assert `canActivate` / `transform` / outcomes.",
    "- **Do not** start a real HTTP server unless the user’s code pattern requires it; prefer **unit** tests with providers overridden.",
    "",
    "## 5. Assertions and quality bar",
    "- Every file should include where possible: **happy path**, **edge cases** (empty, null, zero, max, optional fields), and **error paths** (thrown `HttpException`, rejected promises, bad DTOs).",
    "- **Comments**: top-of-file note on what module is under test; short comment before non-obvious `it` blocks.",
    mockApi,
    " Do not call real external services.",
    "",
    jsonContract,
    "",
    "Output limits:",
    '- `files`: at most ' +
      String(maxOutputFiles) +
      " test modules; `relativePath` uses forward slashes (e.g. `web_monitor_api/src/foo.service.spec.ts`).",
    "- `generatedTestSummary`: one entry per test file, with `sourceFile` from the user’s list and a clear `description` of coverage.",
    "- `content` must be **only** new test code — not a copy of the whole application file.",
  ].join("\n");
}

export type GenerateTestsUserPromptArgs = {
  owner: string;
  repo: string;
  ref: string;
  resolvedCommitSha: string;
  sourceFilePaths: string[];
  sourceBundlesMarkdown: string[];
  packageJsonSection: string;
  upstreamAnalyzeSection: string;
};

/**
 * User message: repo + branch/ref + tech stack + file list + fenced source bodies.
 */
export function buildGenerateTestsUserPrompt(
  args: GenerateTestsUserPromptArgs,
): string {
  const fileList = args.sourceFilePaths.map((p) => `- ${p}`).join("\n");
  return [
    "## Repository",
    `- **Name:** ${args.owner}/${args.repo}`,
    `- **Ref (branch / tag / symbolic):** ${args.ref}`,
    `- **Resolved commit SHA:** ${args.resolvedCommitSha}`,
    "",
    "## Tech stack & tooling",
    args.packageJsonSection.trim() ||
      "_package.json was not available — infer runtime, module format, and test runner only from the source files below._",
    "",
    args.upstreamAnalyzeSection.trim(),
    "",
    "## Instructions",
    "Generate **high-quality unit tests** for the modules below.",
    "- Align imports and mocks with the **actual exports and paths** in each file.",
    "- Respect the tech stack section when choosing assertion style and mocks.",
    "- Derive cases from **real** signatures and behavior in the bundles — do not invent APIs that are not present.",
    "",
    "## Source files included (analyze each)",
    fileList,
    "",
    "## Source code",
    "Each block lists the repository-relative path and the full file contents.",
    "",
    ...args.sourceBundlesMarkdown,
  ].join("\n");
}

/** Best-effort summary of package.json for the LLM (scripts, deps sample). */
export function summarizePackageJsonForPrompt(raw: string): string {
  try {
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const name = typeof pkg.name === "string" ? pkg.name : "(unknown)";
    const typeField =
      typeof pkg.type === "string" ? `module type: ${pkg.type}` : null;
    const deps = {
      ...(typeof pkg.dependencies === "object" && pkg.dependencies !== null
        ? (pkg.dependencies as Record<string, string>)
        : {}),
      ...(typeof pkg.devDependencies === "object" &&
      pkg.devDependencies !== null
        ? (pkg.devDependencies as Record<string, string>)
        : {}),
    };
    const depKeys = Object.keys(deps);
    const scripts =
      typeof pkg.scripts === "object" && pkg.scripts !== null
        ? Object.keys(pkg.scripts as Record<string, unknown>)
        : [];
    const engines =
      typeof pkg.engines === "object" && pkg.engines !== null
        ? JSON.stringify(pkg.engines)
        : "";
    const testScript =
      typeof pkg.scripts === "object" &&
      pkg.scripts !== null &&
      typeof (pkg.scripts as Record<string, unknown>).test === "string"
        ? String((pkg.scripts as Record<string, string>).test)
        : "";

    const lines = [
      `- **package name:** ${name}`,
      typeField ? `- **${typeField}**` : null,
      engines ? `- **engines:** ${engines}` : null,
      testScript ? `- **npm test script:** \`${testScript.slice(0, 200)}${testScript.length > 200 ? "…" : ""}\`` : null,
      scripts.length > 0
        ? `- **script keys:** ${scripts.slice(0, 20).join(", ")}${scripts.length > 20 ? ", …" : ""}`
        : null,
      depKeys.length > 0
        ? `- **dependencies (sample):** ${depKeys.slice(0, 45).join(", ")}${depKeys.length > 45 ? ", …" : ""}`
        : null,
    ].filter(Boolean) as string[];

    return lines.join("\n");
  } catch {
    return "_package.json could not be parsed as JSON._";
  }
}

export function formatUpstreamAnalyzeHints(
  upstream: Record<string, unknown>,
): string {
  const meta = upstream.analysisMeta as
    | {
        detectedRunners?: string[];
        stackTags?: string[];
        heuristicNotes?: string[];
      }
    | undefined;
  if (!meta) return "";
  const parts: string[] = [];
  if (meta.detectedRunners?.length) {
    parts.push(
      `- **Upstream analyze — detected test runners:** ${meta.detectedRunners.join(", ")}`,
    );
  }
  if (meta.stackTags?.length) {
    parts.push(
      `- **Upstream analyze — stack tags:** ${meta.stackTags.join(", ")}`,
    );
  }
  if (meta.heuristicNotes?.length) {
    parts.push(
      `- **Upstream analyze — notes:** ${meta.heuristicNotes.slice(0, 6).join("; ")}`,
    );
  }
  if (parts.length === 0) return "";
  return ["### Hints from `github.repo.analyze` (if present in workflow)", ...parts].join(
    "\n",
  );
}

export function sanitizeGeneratedFiles(
  raw: z.infer<typeof LlmResponseSchema>,
): z.infer<typeof GeneratedTestFileEntrySchema>[] {
  const out: z.infer<typeof GeneratedTestFileEntrySchema>[] = [];
  let total = 0;
  const files = raw.files ?? [];
  for (let i = 0; i < files.length && out.length < MAX_OUTPUT_FILES; i++) {
    const f = files[i];
    if (!f?.relativePath || typeof f.content !== "string") continue;
    const norm = f.relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (!norm || norm.includes("..")) continue;
    const entry = { relativePath: norm, content: f.content };
    const parsed = GeneratedTestFileEntrySchema.safeParse(entry);
    if (!parsed.success) continue;
    total += parsed.data.content.length;
    if (total > MAX_TOTAL_GENERATED_BYTES) break;
    out.push(parsed.data);
  }
  return out;
}

export function sanitizeGeneratedSummary(
  data: z.infer<typeof LlmResponseSchema>,
): z.infer<typeof GeneratedTestSummaryEntrySchema>[] {
  const rows = data.generatedTestSummary ?? [];
  const out: z.infer<typeof GeneratedTestSummaryEntrySchema>[] = [];
  for (const row of rows.slice(0, MAX_SUMMARY_ROWS)) {
    const parsed = GeneratedTestSummaryEntrySchema.safeParse(row);
    if (!parsed.success) continue;
    out.push({
      sourceFile: parsed.data.sourceFile
        .replace(/\\/g, "/")
        .replace(/^\.\/+/, "")
        .trim(),
      testFile: parsed.data.testFile
        ? parsed.data.testFile
            .replace(/\\/g, "/")
            .replace(/^\.\/+/, "")
            .trim()
        : undefined,
      description: parsed.data.description.trim(),
    });
  }
  return out;
}

export function buildFallbackGeneratedTestSummary(
  generated: z.infer<typeof GeneratedTestFileEntrySchema>[],
  sourcePaths: string[],
): z.infer<typeof GeneratedTestSummaryEntrySchema>[] {
  if (generated.length === 0 || sourcePaths.length === 0) return [];
  const out: z.infer<typeof GeneratedTestSummaryEntrySchema>[] = [];
  for (let i = 0; i < generated.length; i++) {
    const g = generated[i]!;
    const src = sourcePaths[Math.min(i, sourcePaths.length - 1)]!;
    out.push({
      sourceFile: src,
      testFile: g.relativePath,
      description:
        "Model omitted `generatedTestSummary`; paired emitted test file with source context by order.",
    });
  }
  return out;
}

/**
 * Strip markdown fences or trailing prose; parse JSON object from model output.
 */
export function tryParseJsonObjectFromModelText(text: string): {
  ok: true;
  value: unknown;
} | { ok: false; error: string; preview: string } {
  const trimmed = text.trim();
  const preview = trimmed.slice(0, 500);

  const attempt = (s: string): unknown | undefined => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };

  let value = attempt(trimmed);
  if (value !== undefined) return { ok: true, value };

  const fence =
    /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed) ??
    /```\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) {
    value = attempt(fence[1].trim());
    if (value !== undefined) return { ok: true, value };
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    value = attempt(trimmed.slice(start, end + 1));
    if (value !== undefined) return { ok: true, value };
  }

  return {
    ok: false,
    error:
      "Response is not valid JSON (tried raw parse, fenced blocks, and substring between first '{' and last '}').",
    preview,
  };
}

export function parseAndValidateLlmFilesResponse(rawText: string): {
  files: z.infer<typeof GeneratedTestFileEntrySchema>[];
  generatedTestSummary: z.infer<typeof GeneratedTestSummaryEntrySchema>[];
  messages: string[];
} {
  const messages: string[] = [];

  const parsed = tryParseJsonObjectFromModelText(rawText);
  if (!parsed.ok) {
    messages.push(`${parsed.error} Preview: ${parsed.preview}`);
    return { files: [], generatedTestSummary: [], messages };
  }

  const shape = LlmResponseSchema.safeParse(parsed.value);
  if (!shape.success) {
    const flat = shape.error.flatten();
    messages.push(
      `Parsed JSON but shape does not match expected schema: ${JSON.stringify(flat)}`,
    );
    return { files: [], generatedTestSummary: [], messages };
  }

  const rawFiles = shape.data.files ?? [];
  if (!Array.isArray(rawFiles)) {
    messages.push('Expected top-level "files" array in JSON object.');
    return { files: [], generatedTestSummary: [], messages };
  }

  const sanitized = sanitizeGeneratedFiles(shape.data);
  const summary = sanitizeGeneratedSummary(shape.data);
  if (sanitized.length === 0 && rawFiles.length > 0) {
    messages.push(
      `Model returned ${rawFiles.length} file entr${rawFiles.length === 1 ? "y" : "ies"}, but none passed validation (paths must be repo-relative, no "..", valid strings).`,
    );
  }
  if (summary.length === 0 && sanitized.length > 0) {
    messages.push(
      "Model did not return usable `generatedTestSummary` rows; a fallback summary will be built.",
    );
  }

  return { files: sanitized, generatedTestSummary: summary, messages };
}

export async function callOpenAiCompatibleJson(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}): Promise<string> {
  const url = `${args.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const temperature = Math.min(
    LLM_TEMPERATURE_CAP,
    Math.max(0, args.temperature),
  );
  const body = {
    model: args.model,
    temperature,
    max_tokens: args.maxTokens,
    response_format: { type: "json_object" as const },
    messages: [
      { role: "system" as const, content: args.system },
      { role: "user" as const, content: args.user },
    ],
  };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), args.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 800)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("LLM returned empty message content");
    }
    return text.trim();
  } finally {
    clearTimeout(t);
  }
}
