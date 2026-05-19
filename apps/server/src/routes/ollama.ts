import type { FastifyInstance } from "fastify";
import { z } from "zod";

const OllamaModelsQuerySchema = z.object({
  baseUrl: z.string().url(),
});

const OllamaTagsResponseSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string().min(1),
      }),
    )
    .default([]),
});

function ollamaApiRoot(baseUrl: string): string {
  const u = new URL(baseUrl);
  if (u.hostname === "localhost") {
    u.hostname = "127.0.0.1";
  }
  u.pathname = u.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

export async function registerOllamaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/ollama/models", async (request, reply) => {
    const query = OllamaModelsQuerySchema.parse(request.query);
    const root = ollamaApiRoot(query.baseUrl);
    const url = `${root}/api/tags`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);

    try {
      const res = await fetch(url, { method: "GET", signal: ac.signal });
      const text = await res.text();
      if (!res.ok) {
        return reply.status(502).send({
          error: "Ollama request failed",
          message: `GET ${url} returned ${res.status}: ${text.slice(0, 400)}`,
        });
      }
      const parsed = OllamaTagsResponseSchema.parse(JSON.parse(text));
      const models = Array.from(new Set(parsed.models.map((m) => m.name))).sort();
      return reply.send({ models });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({
        error: "Could not connect to Ollama",
        message: `Could not connect to Ollama at ${root}: ${message}`,
      });
    } finally {
      clearTimeout(timer);
    }
  });
}
