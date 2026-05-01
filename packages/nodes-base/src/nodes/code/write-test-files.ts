import type { NodeDefinition } from "@wfengine/core";
import { access, constants, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CodeWriteTestFilesConfigSchema,
  CodeWriteTestFilesOutputSchema,
} from "../../config-schemas.js";

export {
  CodeWriteTestFilesConfigSchema,
  CodeWriteTestFilesOutputSchema,
} from "../../config-schemas.js";

type FileEntry = { relativePath: string; content: string };

function normalizeRelativePath(raw: string): string | null {
  const s = raw.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  if (!s) return null;
  for (const seg of s.split("/")) {
    if (seg === "..") return null;
  }
  return s;
}

function resolveSafeAbsolutePath(
  baseDirectory: string,
  relativePath: string,
): string {
  const norm = normalizeRelativePath(relativePath);
  if (!norm) {
    throw new Error(
      `code.write-test-files: invalid relativePath (${JSON.stringify(relativePath)}).`,
    );
  }
  const resolved = path.resolve(baseDirectory, norm);
  const base = path.resolve(baseDirectory);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(
      `code.write-test-files: path escapes baseDirectory (${relativePath}).`,
    );
  }
  return resolved;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function entryFromUnknown(row: unknown): FileEntry | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const rel =
    typeof o.relativePath === "string"
      ? o.relativePath
      : typeof o.path === "string"
        ? o.path
        : "";
  const content = typeof o.content === "string" ? o.content : "";
  const n = normalizeRelativePath(rel);
  if (!n) return null;
  return { relativePath: n, content };
}

function entriesFromArray(items: unknown[]): FileEntry[] {
  const out: FileEntry[] = [];
  for (const item of items) {
    const e = entryFromUnknown(item);
    if (e) out.push(e);
  }
  return out;
}

function resolveFileEntries(
  c: z.infer<typeof CodeWriteTestFilesConfigSchema>,
  inputData: Record<string, unknown>,
): FileEntry[] {
  const gen = inputData.generatedTestFiles;
  if (Array.isArray(gen) && gen.length > 0) {
    const parsed = entriesFromArray(gen);
    if (parsed.length > 0) return parsed;
  }

  if (c.files.length > 0) {
    const out: FileEntry[] = [];
    for (const f of c.files) {
      const n = normalizeRelativePath(f.relativePath);
      if (!n) continue;
      out.push({ relativePath: n, content: f.content });
    }
    if (out.length > 0) return out;
  }

  const filesIn = inputData.files;
  if (Array.isArray(filesIn) && filesIn.length > 0) {
    return entriesFromArray(filesIn);
  }

  return [];
}

export const codeWriteTestFilesNode: NodeDefinition = {
  type: "code.write-test-files",
  label: "Write test files",
  category: "action",
  description:
    "Consumes upstream `generatedTestFiles` from `llm.generate-unit-tests` (uses `relativePath` + `content`; other fields like `framework` are ignored for writing) and writes under `baseDirectory` with safe path checks. Falls back to `files` in config or merged `files`.",
  configSchema:
    CodeWriteTestFilesConfigSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  outputSchema:
    CodeWriteTestFilesOutputSchema as unknown as z.ZodType<
      Record<string, unknown>
    >,
  execute: async ({ config, inputData, context }) => {
    const c = CodeWriteTestFilesConfigSchema.parse(config);
    const upstream = inputData as Record<string, unknown>;

    const baseDirectory = path.resolve(c.baseDirectory);
    const entries = resolveFileEntries(c, upstream);
    const totalRequested = entries.length;

    if (totalRequested === 0) {
      const out = {
        success: false,
        writtenFiles: [] as string[],
        skippedFiles: [] as string[],
        writeSummary: {
          totalRequested: 0,
          totalWritten: 0,
          totalBytesWritten: 0,
          baseDirectory,
        },
        message:
          "No files to write: provide `generatedTestFiles` from upstream, `files` in config, or `files` on merged input.",
      };
      return CodeWriteTestFilesOutputSchema.parse(out);
    }

    context.logger.info(
      `code.write-test-files: ${c.dryRun ? "dry-run — would write" : "writing"} ${totalRequested} test file(s) to ${baseDirectory}`,
    );

    const writtenFiles: string[] = [];
    const skippedFiles: string[] = [];
    let totalBytesWritten = 0;

    for (const entry of entries) {
      let absolute: string;
      try {
        absolute = resolveSafeAbsolutePath(baseDirectory, entry.relativePath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        context.logger.warn("code.write-test-files: skip invalid path", {
          relativePath: entry.relativePath,
          error: msg,
        });
        skippedFiles.push(entry.relativePath);
        continue;
      }

      try {
        const exists = await pathExists(absolute);
        if (exists && !c.overwrite) {
          skippedFiles.push(entry.relativePath);
          context.logger.info("code.write-test-files: skip existing (overwrite=false)", {
            path: absolute,
          });
          continue;
        }

        const payload = Buffer.from(entry.content, "utf8");

        if (c.dryRun) {
          context.logger.info("code.write-test-files: dry-run (would write)", {
            path: absolute,
            bytes: payload.length,
          });
          continue;
        }

        if (c.createDirectories) {
          await mkdir(path.dirname(absolute), { recursive: true });
        }

        await writeFile(absolute, payload);
        writtenFiles.push(absolute);
        totalBytesWritten += payload.length;
        context.logger.debug("code.write-test-files: wrote", {
          path: absolute,
          bytes: payload.length,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        context.logger.warn("code.write-test-files: write failed", {
          path: absolute,
          error: msg,
        });
        skippedFiles.push(entry.relativePath);
      }
    }

    const totalWritten = c.dryRun ? 0 : writtenFiles.length;
    const success =
      totalRequested > 0 &&
      skippedFiles.length === 0 &&
      (c.dryRun || totalWritten === totalRequested);

    let message: string;
    if (c.dryRun) {
      message = `Dry run: would write ${totalRequested} file(s) under ${baseDirectory} (no files written).`;
    } else if (totalWritten === totalRequested && skippedFiles.length === 0) {
      message = `Wrote ${totalWritten} file(s) (${totalBytesWritten} bytes) under ${baseDirectory}.`;
    } else {
      message = `Wrote ${totalWritten} of ${totalRequested} file(s) (${totalBytesWritten} bytes); ${skippedFiles.length} skipped or failed.`;
    }

    const output = {
      success,
      writtenFiles,
      skippedFiles,
      writeSummary: {
        totalRequested,
        totalWritten,
        totalBytesWritten,
        baseDirectory,
      },
      message,
    };

    return CodeWriteTestFilesOutputSchema.parse(output);
  },
};
