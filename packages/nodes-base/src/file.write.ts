import type { NodeDefinition } from "@wfengine/core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  FileWriteConfigSchema,
  FileWriteOutputSchema,
} from "./config-schemas.js";
import { interpolateTemplate } from "./template-interpolate.js";

export {
  FileWriteConfigSchema,
  FileWriteOutputSchema,
} from "./config-schemas.js";

export type FileWriteConfig = z.infer<typeof FileWriteConfigSchema>;

function resolveSafePath(filePath: string, baseDir: string): string {
  const resolved = path.resolve(baseDir, filePath);
  const base = path.resolve(baseDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(
      `file.write: path escapes baseDir (${filePath}). Use paths inside baseDir.`,
    );
  }
  return resolved;
}

export const fileWriteNode: NodeDefinition = {
  type: "file.write",
  label: "Write file",
  category: "action",
  description:
    "Write text or base64-decoded content to a path under baseDir (default cwd).",
  configSchema:
    FileWriteConfigSchema as unknown as z.ZodType<Record<string, unknown>>,
  outputSchema:
    FileWriteOutputSchema as unknown as z.ZodType<Record<string, unknown>>,
  execute: async ({ config, inputData, context }) => {
    const c = FileWriteConfigSchema.parse(config);
    const base = c.baseDir ?? process.cwd();
    const target = resolveSafePath(c.path, base);

    if (c.createDirs) {
      await mkdir(path.dirname(target), { recursive: true });
    }

    const mergedIn = inputData as Record<string, unknown>;
    const rawContent =
      c.encoding === "utf8" && c.interpolateContentFromInput
        ? interpolateTemplate(c.content, mergedIn)
        : c.content;

    let data: string | Buffer =
      c.encoding === "base64"
        ? Buffer.from(rawContent, "base64")
        : rawContent;

    const payload =
      typeof data === "string" ? Buffer.from(data, "utf8") : data;

    context.logger.info("file.write", { path: target, append: c.append });

    if (c.append) {
      await writeFile(target, payload, { flag: "a" });
    } else {
      await writeFile(target, payload);
    }

    return {
      path: target,
      bytesWritten: payload.length,
      append: c.append,
    };
  },
};
