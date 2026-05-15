export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function openAiChatCompletion(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  timeoutMs: number;
}): Promise<string> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature,
      }),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `OpenAI-compatible error ${res.status}: ${text.slice(0, 800)}`,
      );
    }
    const j = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const c = j.choices?.[0]?.message?.content;
    if (typeof c !== "string") {
      throw new Error("Model returned no text content");
    }
    return c;
  } finally {
    clearTimeout(timer);
  }
}

/** Result of resolving which OpenAI-compatible backend to call. */
export type ResolvedOpenAiEndpoint = {
  baseUrl: string;
  apiKey: string;
  /** True when no OpenAI API key was found but `OLLAMA_BASE_URL` / `WFENGINE_OLLAMA_BASE_URL` was set. */
  usedOllamaEnvFallback: boolean;
};

function envTrim(key: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/**
 * Resolves OpenAI-compatible endpoint + API key.
 * Precedence: config fields → env (`WFENGINE_*` before `OPENAI_*`).
 *
 * **Ollama fallback:** If no OpenAI key is present but `WFENGINE_OLLAMA_BASE_URL` or
 * `OLLAMA_BASE_URL` is set (with optional `/v1`), uses that host with `ollama` (or
 * `OLLAMA_API_KEY`) so local/self-hosted runs work without `OPENAI_API_KEY`.
 */
export function resolveOpenAiFromEnv(config: {
  openAiBaseUrl?: string | undefined;
  openAiApiKey?: string | undefined;
}): ResolvedOpenAiEndpoint {
  const fromConfigKey = config.openAiApiKey?.trim();
  const fromEnvKey =
    envTrim("WFENGINE_OPENAI_API_KEY") ?? envTrim("OPENAI_API_KEY") ?? "";
  const apiKey = fromConfigKey || fromEnvKey;

  const fromConfigBase = config.openAiBaseUrl?.trim();
  const fromEnvOpenAiBase =
    envTrim("WFENGINE_OPENAI_BASE_URL") ?? envTrim("OPENAI_BASE_URL") ?? "";
  let baseUrl =
    (fromConfigBase && fromConfigBase.length > 0 ? fromConfigBase : "") ||
    fromEnvOpenAiBase ||
    "https://api.openai.com/v1";
  baseUrl = baseUrl.replace(/\/$/, "");

  const ollamaBase =
    envTrim("WFENGINE_OLLAMA_BASE_URL") ?? envTrim("OLLAMA_BASE_URL") ?? "";

  const hasOpenAiKey = Boolean(apiKey);

  if (!hasOpenAiKey && ollamaBase) {
    const ollamaKey =
      envTrim("WFENGINE_OLLAMA_API_KEY") ??
      envTrim("OLLAMA_API_KEY") ??
      "ollama";
    return {
      baseUrl: ollamaBase.replace(/\/$/, ""),
      apiKey: ollamaKey,
      usedOllamaEnvFallback: true,
    };
  }

  return {
    baseUrl,
    apiKey: apiKey || "",
    usedOllamaEnvFallback: false,
  };
}

/**
 * When using Ollama env fallback, prefer `OLLAMA_MODEL` / `WFENGINE_OLLAMA_MODEL`;
 * if the node still references an OpenAI-style id (`gpt-…`) and no env model is set,
 * default to `llama3.2` so typical workflows do not send invalid model names to Ollama.
 */
export function effectiveLlmModel(
  nodeModel: string | undefined,
  usedOllamaEnvFallback: boolean,
): string {
  const fallback = envTrim("OLLAMA_MODEL") ?? envTrim("WFENGINE_OLLAMA_MODEL");
  if (usedOllamaEnvFallback && fallback) {
    return fallback;
  }
  const m = (nodeModel?.trim() || "gpt-4o-mini").trim();
  if (usedOllamaEnvFallback) {
    if (m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("text-")) {
      return "llama3.2";
    }
  }
  return m;
}
