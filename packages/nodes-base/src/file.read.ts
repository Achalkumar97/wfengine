import type { NodeDefinition } from "@wfengine/core";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  FileReadConfigSchema,
  FileReadOutputSchema,
} from "./config-schemas.js";

export {
  FileReadConfigSchema,
  FileReadOutputSchema,
} from "./config-schemas.js";

export type FileReadConfig = z.infer<typeof FileReadConfigSchema>;

function resolveSafePath(filePath: string, baseDir: string): string {
  const resolved = path.resolve(baseDir, filePath);
  const base = path.resolve(baseDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(
      `file.read: path escapes baseDir (${filePath}). Use paths inside baseDir.`,
    );
  }
  return resolved;
}

export const fileReadNode: NodeDefinition = {
  type: "file.read",
  label: "Read file",
  category: "action",
  description: "Read a file from disk (UTF-8 text, base64, or raw length-capped).",
  configSchema:
    FileReadConfigSchema as unknown as z.ZodType<Record<string, unknown>>,
  outputSchema:
    FileReadOutputSchema as unknown as z.ZodType<Record<string, unknown>>,
  execute: async ({ config, inputData, context }) => {
    const c = FileReadConfigSchema.parse(config);
    const base = c.baseDir ?? process.cwd();
    const target = resolveSafePath(c.path, base);

    context.logger.info("file.read", { path: target });

    const buf = await readFile(target);
    if (buf.length > c.maxBytes) {
      throw new Error(
        `file.read: file size ${buf.length} exceeds maxBytes ${c.maxBytes}`,
      );
    }

    if (c.encoding === "utf8") {
      return {
        path: target,
        encoding: "utf8",
        size: buf.length,
        content: buf.toString("utf8"),
      };
    }

    if (c.encoding === "base64") {
      return {
        path: target,
        encoding: "base64",
        size: buf.length,
        content: buf.toString("base64"),
      };
    }

    return {
      path: target,
      encoding: "binary",
      size: buf.length,
      content: buf.toString("binary"),
    };
  },
};
