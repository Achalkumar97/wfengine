import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";

export function verifyApiKey(expected: string | undefined): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!expected) return;
    const path = (request.url ?? "").split("?")[0] ?? "";
    if (
      path === "/health" ||
      path.startsWith("/hooks/") ||
      path.startsWith("/api-docs")
    ) {
      return;
    }
    const header = request.headers["x-api-key"];
    const key = typeof header === "string" ? header : header?.[0];
    if (key !== expected) {
      await reply.status(401).send({ error: "Unauthorized" });
      return;
    }
  };
}
