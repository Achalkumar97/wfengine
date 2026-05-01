import type { NodeDefinition } from "@wfengine/core";
import { z } from "zod";
import {
  GeneratedUnitTestFileSchema,
  LlmGenerateUnitTestsConfigSchema,
  LlmGenerateUnitTestsOutputSchema,
} from "../../config-schemas.js";
import {
  callOpenAiCompatibleJson,
  MAX_TOTAL_GENERATED_BYTES,
  tryParseJsonObjectFromModelText,
} from "../github/generate-tests-llm.js";
import {
  buildLlmGenerateUnitTestsSystemPrompt,
  buildLlmGenerateUnitTestsUserMessage,
  type PreferredTestStyle,
  type SourceFileBundle,
} from "./generate-unit-tests-prompts.js";
import { resolveGithubRepoContext } from "../github/github-repo-context.js";
import { resolveGithubToken } from "../github/github-token-resolve.js";

export {
  LlmGenerateUnitTestsConfigSchema,
  LlmGenerateUnitTestsOutputSchema,
  GeneratedUnitTestFileSchema,
} from "../../config-schemas.js";

const LANGUAGE_SET = new Set(
  GeneratedUnitTestFileSchema.shape.language.options,
);

const LlmRawUnitTestsResponseSchema = z.object({
  generatedTestFiles: z
    .array(
      z.object({
        relativePath: z.string(),
        content: z.string(),
        language: z.string().optional(),
        framework: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  notes: z.array(z.string()).optional(),
});

function resolveOpenAiFromConfig(
  c: z.infer<typeof LlmGenerateUnitTestsConfigSchema>,
): { baseUrl: string; apiKey: string } {
  const baseUrl = (
    (c.openAiBaseUrl && c.openAiBaseUrl.trim()) ||
    (typeof process !== "undefined" && process.env
      ? process.env.WFENGINE_OPENAI_BASE_URL ||
        process.env.OPENAI_BASE_URL ||
        ""
      : "") ||
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const apiKey =
    (c.openAiApiKey && c.openAiApiKey.trim()) ||
    (typeof process !== "undefined" && process.env
      ? process.env.WFENGINE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || ""
      : "");
  return { baseUrl, apiKey };
}

function normalizeLanguage(
  raw: string | undefined,
): z.infer<typeof GeneratedUnitTestFileSchema>["language"] {
  const s = (raw ?? "").trim().toLowerCase();
  const aliases: Record<string, z.infer<typeof GeneratedUnitTestFileSchema>["language"]> = {
    golang: "go",
    ts: "typescript",
    js: "javascript",
    csharp: "csharp",
    "c#": "csharp",
    dotnet: "csharp",
    rs: "rust",
    kt: "kotlin",
    cxx: "cpp",
    "c++": "cpp",
  };
  const mapped = aliases[s] ?? s;
  if (
    LANGUAGE_SET.has(mapped as z.infer<typeof GeneratedUnitTestFileSchema>["language"])
  ) {
    return mapped as z.infer<typeof GeneratedUnitTestFileSchema>["language"];
  }
  return "unknown";
}

function normalizeFramework(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  if (t.length === 0) return "unspecified";
  return t.slice(0, 120);
}

/**
 * Accept `files` from upstream (e.g. `github.files.read`) or `targetFiles` + `fileContents`.
 */
function extractSourceBundles(input: Record<string, unknown>): {
  bundles: SourceFileBundle[];
  extractWarnings: string[];
} {
  const extractWarnings: string[] = [];
  const rawFiles = input.files;
  if (Array.isArray(rawFiles)) {
    const out: SourceFileBundle[] = [];
    for (const item of rawFiles) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const pathRaw =
        typeof o.path === "string"
          ? o.path
          : typeof o.relativePath === "string"
            ? o.relativePath
            : "";
      const content = typeof o.content === "string" ? o.content : "";
      const path = pathRaw.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
      if (!path || !content) continue;
      out.push({ path, content });
    }
    if (out.length > 0) return { bundles: out, extractWarnings };
  }

  const targets = input.targetFiles;
  const fileContents = input.fileContents;
  if (
    Array.isArray(targets) &&
    fileContents &&
    typeof fileContents === "object" &&
    !Array.isArray(fileContents)
  ) {
    const map = fileContents as Record<string, unknown>;
    const out: SourceFileBundle[] = [];
    for (const t of targets) {
      if (typeof t !== "string") continue;
      const c = map[t];
      if (typeof c !== "string") continue;
      const path = t.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
      if (path) out.push({ path, content: c });
    }
    if (out.length > 0) return { bundles: out, extractWarnings };
  }

  extractWarnings.push(
    "No source bundles found. Provide `files`: [{ path or relativePath, content }] from upstream, or `targetFiles` + `fileContents` map.",
  );
  return { bundles: [], extractWarnings };
}

function applySourceLimits(
  bundles: SourceFileBundle[],
  opts: {
    maxSourceFiles: number;
    maxCharsPerSourceFile: number;
    maxTotalInputChars: number;
  },
): { files: SourceFileBundle[]; limitWarnings: string[] } {
  const sorted = [...bundles].sort((a, b) => a.path.localeCompare(b.path));
  const limitWarnings: string[] = [];
  const out: SourceFileBundle[] = [];
  let total = 0;
  const slice = sorted.slice(0, opts.maxSourceFiles);

  for (const b of slice) {
    let content = b.content;
    if (content.length > opts.maxCharsPerSourceFile) {
      content =
        content.slice(0, opts.maxCharsPerSourceFile) +
        "\n\n/* …truncated for LLM context … */";
      limitWarnings.push(
        `Truncated \`${b.path}\` to ${opts.maxCharsPerSourceFile} characters.`,
      );
    }
    if (total + content.length > opts.maxTotalInputChars) {
      const room = opts.maxTotalInputChars - total;
      if (room < 200) {
        limitWarnings.push(
          `Skipped remaining sources: would exceed maxTotalInputChars (${opts.maxTotalInputChars}).`,
        );
        break;
      }
      content =
        content.slice(0, room) + "\n\n/* …truncated to fit maxTotalInputChars … */";
      limitWarnings.push(
        `Hard-truncated \`${b.path}\` so the prompt stays within maxTotalInputChars.`,
      );
    }
    total += content.length;
    out.push({ path: b.path, content });
    if (total >= opts.maxTotalInputChars) break;
  }

  return { files: out, limitWarnings };
}

function sanitizeGeneratedUnitTestFiles(
  raw: z.infer<typeof LlmRawUnitTestsResponseSchema>,
  maxFiles: number,
): {
  files: z.infer<typeof GeneratedUnitTestFileSchema>[];
  messages: string[];
} {
  const messages: string[] = [];
  const rows = raw.generatedTestFiles ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    messages.push('Expected non-empty `generatedTestFiles` array in model JSON.');
    return { files: [], messages };
  }

  const out: z.infer<typeof GeneratedUnitTestFileSchema>[] = [];
  let totalBytes = 0;

  for (let i = 0; i < rows.length && out.length < maxFiles; i++) {
    const f = rows[i];
    if (!f?.relativePath || typeof f.content !== "string") continue;
    const norm = f.relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (!norm || norm.includes("..")) {
      messages.push(`Skipped invalid test path at index ${i}.`);
      continue;
    }
    const description =
      typeof f.description === "string" && f.description.trim().length > 0
        ? f.description.trim().slice(0, 2000)
        : "Model omitted description; tests target the paired source context.";
    const entry = {
      relativePath: norm,
      content: f.content,
      language: normalizeLanguage(f.language),
      framework: normalizeFramework(f.framework),
      description,
    };
    const parsed = GeneratedUnitTestFileSchema.safeParse(entry);
    if (!parsed.success) {
      messages.push(`Entry at index ${i} failed validation.`);
      continue;
    }
    const nextTotal = totalBytes + parsed.data.content.length;
    if (nextTotal > MAX_TOTAL_GENERATED_BYTES) {
      messages.push(
        `Stopped: total generated test bytes would exceed ${MAX_TOTAL_GENERATED_BYTES}.`,
      );
      break;
    }
    totalBytes = nextTotal;
    out.push(parsed.data);
  }

  if (out.length === 0 && rows.length > 0) {
    messages.push(
      "Model returned test file entries, but none passed path and schema validation.",
    );
  }

  return { files: out, messages };
}

export const llmGenerateUnitTestsNode: NodeDefinition = {
  type: "llm.generate-unit-tests",
  label: "LLM: Generate unit tests",
  category: "action",
  description:
    "After `github.files.read` (or any node supplying `files`): multi-language, framework-aware unit tests (Python, TS/JS, Go, Java, C#, Rust, Ruby, PHP, and more). Detects language from paths/content; honors `preferredTestStyle`. Returns `generatedTestFiles` with `relativePath`, `content`, `language`, `framework`, `description`. Pair with `code.write-test-files`.",
  configSchema:
    LlmGenerateUnitTestsConfigSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  outputSchema:
    LlmGenerateUnitTestsOutputSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  execute: async ({ config, inputData, context }) => {
    const c = LlmGenerateUnitTestsConfigSchema.parse(config);
    const upstream = inputData as Record<string, unknown>;

    const { baseUrl, apiKey } = resolveOpenAiFromConfig(c);
    if (!apiKey) {
      throw new Error(
        "llm.generate-unit-tests: set openAiApiKey in config or OPENAI_API_KEY / WFENGINE_OPENAI_API_KEY on the runner.",
      );
    }

    const { bundles, extractWarnings } = extractSourceBundles(upstream);
    const { files: limitedBundles, limitWarnings } = applySourceLimits(bundles, {
      maxSourceFiles: c.maxSourceFiles,
      maxCharsPerSourceFile: c.maxCharsPerSourceFile,
      maxTotalInputChars: c.maxTotalInputChars,
    });

    if (limitedBundles.length === 0) {
      throw new Error(
        `llm.generate-unit-tests: no source content to send to the model. ${extractWarnings.join(" ")}`,
      );
    }

    const ctx = resolveGithubRepoContext(
      { owner: c.gitOwner, repo: c.gitRepo, ref: c.gitRef },
      upstream,
      "",
    );
    const gitOwner = ctx.owner || undefined;
    const gitRepo = ctx.repo || undefined;
    const gitRef = ctx.ref || undefined;
    const githubPat = resolveGithubToken(c.githubToken, upstream);
    const commitShaRaw = upstream.commitSha ?? upstream.resolvedCommitSha;
    const commitSha =
      typeof commitShaRaw === "string" ? commitShaRaw.trim() || undefined : undefined;

    const preferredTestStyle = (c.preferredTestStyle ??
      "auto") as PreferredTestStyle;

    const system = buildLlmGenerateUnitTestsSystemPrompt({
      targetLanguage: c.targetLanguage,
      preferredTestStyle,
      maxGeneratedFiles: c.maxGeneratedFiles,
    });
    const user = buildLlmGenerateUnitTestsUserMessage({
      gitOwner,
      gitRepo,
      gitRef,
      commitSha,
      files: limitedBundles,
      preferredTestStyle,
    });

    const sourcePaths = limitedBundles.map((f) => f.path);
    const runnerNotes = [...extractWarnings, ...limitWarnings].filter(
      (s) => s.length > 0,
    );

    let generated: z.infer<typeof GeneratedUnitTestFileSchema>[] = [];
    let modelNotes: string[] | undefined;
    let generateWarning: string | undefined;

    try {
      const rawText = await callOpenAiCompatibleJson({
        baseUrl,
        apiKey,
        model: c.model,
        system,
        user,
        temperature: c.temperature,
        maxTokens: c.llmMaxTokens,
        timeoutMs: c.llmTimeoutMs,
      });

      const parsedJson = tryParseJsonObjectFromModelText(rawText);
      if (!parsedJson.ok) {
        generateWarning = `${parsedJson.error} Preview: ${parsedJson.preview}`;
      } else {
        const shape = LlmRawUnitTestsResponseSchema.safeParse(parsedJson.value);
        if (!shape.success) {
          generateWarning = `Model JSON shape unexpected: ${JSON.stringify(shape.error.flatten())}`;
        } else {
          modelNotes = shape.data.notes;
          const { files, messages } = sanitizeGeneratedUnitTestFiles(
            shape.data,
            c.maxGeneratedFiles,
          );
          generated = files;
          if (messages.length > 0) {
            generateWarning = messages.join(" ");
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      generateWarning = msg;
      context.logger.warn("llm.generate-unit-tests: LLM call failed", {
        error: msg,
      });
    }

    const notesMerged = [
      ...(modelNotes ?? []),
      ...runnerNotes,
    ];
    const notesOut = notesMerged.length > 0 ? notesMerged : undefined;

    const output = {
      generatedTestFiles: generated,
      notes: notesOut,
      llmModel: c.model,
      sourceFilesUsed: sourcePaths,
      generateWarning,
      gitOwner,
      gitRepo,
      gitRef,
      ...(githubPat ? { githubToken: githubPat } : {}),
    };

    return LlmGenerateUnitTestsOutputSchema.parse(output);
  },
};
