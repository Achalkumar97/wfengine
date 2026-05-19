import type { NodeDefinition } from "@wfengine/core";
import { z } from "zod";
import { HttpRequestConfigSchema } from "./config-schemas.js";
import { redactSecretsDeep } from "./redact-secrets.js";

export { HttpRequestConfigSchema } from "./config-schemas.js";

function sanitizeResponseHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const redactKey =
    /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = redactKey.test(k) ? "[redacted]" : v;
  }
  return out;
}

function readHttpBaseFromEnv(): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const b = process.env.WFENGINE_HTTP_BASE_URL?.trim();
  if (!b) return undefined;
  return b.replace(/\/$/, "");
}

/**
 * Resolves a workflow HTTP node URL: absolute https URLs as-is; relative paths
 * join with `WFENGINE_HTTP_BASE_URL` (e.g. `https://api.open-meteo.com`).
 */
export function resolveWorkflowHttpUrl(urlStr: string): string {
  const raw = urlStr.trim();
  if (raw.length === 0) {
    throw new Error("HTTP request: url is empty");
  }
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return u.href;
    }
    throw new Error(`Unsupported URL protocol: ${u.protocol}`);
  } catch (e) {
    if (e instanceof TypeError || (e instanceof Error && e.message.startsWith("Invalid URL"))) {
      const base = readHttpBaseFromEnv();
      if (base && raw.startsWith("/")) {
        const join = new URL(raw, base.endsWith("/") ? base + "/" : base + "/");
        if (join.protocol === "http:" || join.protocol === "https:") {
          return join.href;
        }
      }
      throw new Error(
        `Invalid or relative HTTP url "${raw}". ` +
          `Use a full URL (https://...) or set WFENGINE_HTTP_BASE_URL on the runner and use a path like /v1/forecast (see .env.example).`,
      );
    }
    throw e;
  }
}

function assertSafeUrlResolved(urlStr: string): URL {
  const u = new URL(urlStr);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${u.protocol}`);
  }
  return u;
}

export const httpRequestNode: NodeDefinition = {
  type: "http.request",
  label: "HTTP Request",
  category: "action",
  configSchema: HttpRequestConfigSchema,
  execute: async ({ config, context }) => {
    const c = config as z.infer<typeof HttpRequestConfigSchema>;
    const resolvedUrl = resolveWorkflowHttpUrl(c.url);
    assertSafeUrlResolved(resolvedUrl);

    const controller = new AbortController();
    // Link parent cancellation so Stop aborts this HTTP request immediately.
    const onAbort = () => controller.abort();
    context.signal?.addEventListener("abort", onAbort, { once: true });
    const t = setTimeout(() => controller.abort(), c.timeoutMs);
    try {
      let body: string | undefined;
      if (c.body !== undefined) {
        body =
          typeof c.body === "string"
            ? c.body
            : JSON.stringify(c.body);
      }

      context.logger.info("HTTP request", { url: resolvedUrl, method: c.method });

      const res = await fetch(resolvedUrl, {
        method: c.method,
        headers: {
          "content-type": "application/json",
          ...c.headers,
        },
        body:
          c.method !== "GET" && c.method !== "HEAD" ? body : undefined,
        signal: controller.signal,
      });

      const buf = await res.arrayBuffer();
      if (buf.byteLength > c.maxBodyBytes) {
        throw new Error(
          `Response body exceeds maxBodyBytes (${buf.byteLength} > ${c.maxBodyBytes})`,
        );
      }

      const text = new TextDecoder().decode(buf);
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        /* leave as string */
      }

      return {
        status: res.status,
        ok: res.ok,
        headers: sanitizeResponseHeaders(
          Object.fromEntries(res.headers.entries()),
        ),
        body: redactSecretsDeep(parsed),
      };
    } finally {
      clearTimeout(t);
      context.signal?.removeEventListener("abort", onAbort);
    }
  },
};
