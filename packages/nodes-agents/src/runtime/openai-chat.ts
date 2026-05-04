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

/**
 * Resolves OpenAI-compatible endpoint + API key.
 * Precedence: config fields → env (`WFENGINE_*` before `OPENAI_*`).
 */
export function resolveOpenAiFromEnv(config: {
  openAiBaseUrl?: string | undefined;
  openAiApiKey?: string | undefined;
}): { baseUrl: string; apiKey: string } {
  const baseUrl = (
    (config.openAiBaseUrl && config.openAiBaseUrl.trim()) ||
    (typeof process !== "undefined" && process.env
      ? process.env.WFENGINE_OPENAI_BASE_URL?.trim() ||
        process.env.OPENAI_BASE_URL?.trim() ||
        ""
      : "") ||
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const apiKey =
    (config.openAiApiKey && config.openAiApiKey.trim()) ||
    (typeof process !== "undefined" && process.env
      ? process.env.WFENGINE_OPENAI_API_KEY?.trim() ||
        process.env.OPENAI_API_KEY?.trim() ||
        ""
      : "") ||
    "";
  return { baseUrl, apiKey };
}
