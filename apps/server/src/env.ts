import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Repo-root `.env` (same file `dotenv-cli` uses in npm scripts). Ensures OPENAI_* / WFENGINE_OPENAI_* exist when not using dotenv-cli. */
function loadRepoRootEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const rootEnv = resolve(here, "../../../.env");
  if (existsSync(rootEnv)) {
    loadDotenv({ path: rootEnv });
  }
}

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().optional().default(30001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  loadRepoRootEnv();
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
