export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmProvider = "openai" | "ollama";

export type ResolvedLlmConfig = {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** True when an older/no-toggle config fell through to Ollama because no OpenAI key was available. */
  usedLegacyOllamaFallback: boolean;
};

export type LlmNodeConfig = {
  llmProvider?: LlmProvider | undefined;
  model?: string | undefined;
  openAiBaseUrl?: string | undefined;
  openAiApiKey?: string | undefined;
  ollamaBaseUrl?: string | undefined;
  llmProviderWasExplicit?: boolean | undefined;
};

export async function openAiChatCompletion(opts: {
  provider?: LlmProvider | undefined;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  timeoutMs: number;
}): Promise<string> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const provider = opts.provider ?? "openai";
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
        `${providerLabel(provider)} chat completion failed (${res.status}) at ${url}: ${text.slice(0, 800)}`,
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
  } catch (err) {
    if (err instanceof Error && err.message.includes("chat completion failed")) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${providerLabel(provider)} chat completion request failed at ${url}: ${message}`,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }
}

function envTrim(key: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[key]?.trim().replace(/^["']|["']$/g, "");
  return v && v.length > 0 ? v : undefined;
}

function cleanUrl(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");
}

function providerLabel(provider: LlmProvider | undefined): string {
  return provider === "ollama" ? "Ollama" : "OpenAI-compatible";
}

function openAiModel(nodeModel: string | undefined): string {
  return (
    nodeModel?.trim() ||
    envTrim("WFENGINE_OPENAI_MODEL") ||
    envTrim("OPENAI_MODEL") ||
    "gpt-4o-mini"
  );
}

function ollamaModel(nodeModel: string | undefined): string {
  const envModel = envTrim("WFENGINE_OLLAMA_MODEL") ?? envTrim("OLLAMA_MODEL");
  const model = nodeModel?.trim();
  if (!model || model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("text-")) {
    return envModel || "llama3.2";
  }
  return model;
}

/**
 * Resolves the LLM backend selected by the node's `llmProvider` toggle.
 *
 * Backward compatibility: older workflows have no `llmProvider`. Because schemas now
 * default it to `openai`, this resolver still falls back to Ollama when there is no
 * OpenAI key and an Ollama URL is configured.
 */
export function resolveLlmConfig(nodeConfig: LlmNodeConfig): ResolvedLlmConfig {
  const rawProvider =
    typeof nodeConfig.llmProvider === "string"
      ? nodeConfig.llmProvider.trim().toLowerCase()
      : "";
  const nodeOllamaBaseUrl = nodeConfig.ollamaBaseUrl?.trim();
  const provider =
    rawProvider === "ollama" || (!rawProvider && Boolean(nodeOllamaBaseUrl))
      ? "ollama"
      : "openai";

  const openAiApiKey =
    nodeConfig.openAiApiKey?.trim() ||
    envTrim("WFENGINE_OPENAI_API_KEY") ||
    envTrim("OPENAI_API_KEY") ||
    "";
  const openAiBaseUrl = cleanUrl(
    nodeConfig.openAiBaseUrl?.trim() ||
      envTrim("WFENGINE_OPENAI_BASE_URL") ||
      envTrim("OPENAI_BASE_URL") ||
      "https://api.openai.com/v1",
  );

  const ollamaBaseUrlRaw =
    nodeOllamaBaseUrl ||
    envTrim("WFENGINE_OLLAMA_BASE_URL") ||
    envTrim("OLLAMA_BASE_URL") ||
    "";
  const ollamaBaseUrl = cleanUrl(ollamaBaseUrlRaw || "http://127.0.0.1:11434/v1");
  const ollamaApiKey =
    envTrim("WFENGINE_OLLAMA_API_KEY") ?? envTrim("OLLAMA_API_KEY") ?? "ollama";

  if (provider === "ollama") {
    const resolved = {
      provider: "ollama",
      baseUrl: ollamaBaseUrl,
      apiKey: ollamaApiKey,
      model: ollamaModel(nodeConfig.model),
      usedLegacyOllamaFallback: false,
    } satisfies ResolvedLlmConfig;
    logResolvedLlmConfig(resolved);
    return resolved;
  }

  if (!nodeConfig.llmProviderWasExplicit && !openAiApiKey && ollamaBaseUrlRaw) {
    const resolved = {
      provider: "ollama",
      baseUrl: ollamaBaseUrl,
      apiKey: ollamaApiKey,
      model: ollamaModel(nodeConfig.model),
      usedLegacyOllamaFallback: true,
    } satisfies ResolvedLlmConfig;
    logResolvedLlmConfig(resolved);
    return resolved;
  }

  const resolved = {
    provider: "openai",
    baseUrl: openAiBaseUrl,
    apiKey: openAiApiKey,
    model: openAiModel(nodeConfig.model),
    usedLegacyOllamaFallback: false,
  } satisfies ResolvedLlmConfig;
  logResolvedLlmConfig(resolved);
  return resolved;
}

function logResolvedLlmConfig(config: ResolvedLlmConfig): void {
  const suffix = config.usedLegacyOllamaFallback ? " | legacy fallback" : "";
  console.log(
    `[LLM] Using provider: ${config.provider} | BaseURL: ${config.baseUrl} | Model: ${config.model}${suffix}`,
  );
}

/** @deprecated Use `resolveLlmConfig()` so the provider toggle is honored. */
export function resolveOpenAiFromEnv(config: LlmNodeConfig): {
  baseUrl: string;
  apiKey: string;
  usedOllamaEnvFallback: boolean;
} {
  const resolved = resolveLlmConfig(config);
  return {
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    usedOllamaEnvFallback: resolved.provider === "ollama",
  };
}

/** @deprecated Use the `model` returned by `resolveLlmConfig()`. */
export function effectiveLlmModel(
  nodeModel: string | undefined,
  usedOllamaEnvFallback: boolean,
): string {
  return usedOllamaEnvFallback ? ollamaModel(nodeModel) : openAiModel(nodeModel);
}
