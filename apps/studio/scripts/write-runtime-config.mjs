import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const outFile = resolve(here, "../dist/runtime-config.js");

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const rootEnv = parseEnvFile(resolve(repoRoot, ".env"));
const studioEnv = parseEnvFile(resolve(here, "../.env"));

function env(name) {
  return process.env[name] ?? studioEnv[name] ?? rootEnv[name] ?? "";
}

const config = {
  VITE_WFENGINE_API: env("VITE_WFENGINE_API"),
  VITE_WFENGINE_API_KEY: env("VITE_WFENGINE_API_KEY"),
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  `window.__WFENGINE_STUDIO_CONFIG__ = ${JSON.stringify(config)};\n`,
  "utf8",
);
