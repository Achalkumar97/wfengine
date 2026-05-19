import { apiBase, authHeaders } from "./server-api.js";

const MODEL_CACHE = new Map<string, Promise<string[]>>();

type OllamaTagsResponse = {
  models?: Array<{ name?: unknown }>;
};

type OllamaProxyResponse = {
  models?: unknown;
  message?: unknown;
  error?: unknown;
};

function normalizeOllamaBaseUrl(raw: string): string {
  const fallback = "http://127.0.0.1:11434/v1";
  const value = raw.trim() || fallback;
  const u = new URL(value);
  if (u.hostname === "localhost") {
    u.hostname = "127.0.0.1";
  }
  u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString().replace(/\/$/, "");
}

function ollamaApiRoot(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.pathname = u.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

function uniqueSortedModelNames(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const names = values
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const name = (item as { name?: unknown }).name;
        return typeof name === "string" ? name.trim() : "";
      }
      return "";
    })
    .filter((name) => name.length > 0);
  return Array.from(new Set(names)).sort();
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit): Promise<unknown> {
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), 8_000);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      const message =
        body && typeof body === "object"
          ? ((body as OllamaProxyResponse).message ??
              (body as OllamaProxyResponse).error)
          : body;
      throw new Error(
        typeof message === "string" && message.trim()
          ? message
          : `HTTP ${res.status}`,
      );
    }
    return body;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchViaProxy(baseUrl: string): Promise<string[]> {
  const base = apiBase();
  if (!base) {
    throw new Error("No wfengine API base configured");
  }
  const url = `${base}/api/ollama/models?baseUrl=${encodeURIComponent(baseUrl)}`;
  const body = (await fetchJsonWithTimeout(url, {
    method: "GET",
    headers: authHeaders(),
  })) as OllamaProxyResponse;
  const models = uniqueSortedModelNames(body.models);
  if (models.length < 1) {
    throw new Error("Ollama returned no models");
  }
  return models;
}

async function fetchDirect(baseUrl: string): Promise<string[]> {
  const url = `${ollamaApiRoot(baseUrl)}/api/tags`;
  const body = (await fetchJsonWithTimeout(url)) as OllamaTagsResponse;
  const models = uniqueSortedModelNames(body.models);
  if (models.length < 1) {
    throw new Error("Ollama returned no models");
  }
  return models;
}

export function clearOllamaModelCache(baseUrl?: string): void {
  if (baseUrl) {
    MODEL_CACHE.delete(normalizeOllamaBaseUrl(baseUrl));
    return;
  }
  MODEL_CACHE.clear();
}

export async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const normalized = normalizeOllamaBaseUrl(baseUrl);
  const cached = MODEL_CACHE.get(normalized);
  if (cached) return cached;

  const request = (async () => {
    try {
      return await fetchViaProxy(normalized);
    } catch {
      return await fetchDirect(normalized);
    }
  })();

  MODEL_CACHE.set(normalized, request);
  try {
    return await request;
  } catch (err) {
    MODEL_CACHE.delete(normalized);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not connect to Ollama at ${normalized}: ${message}`);
  }
}
