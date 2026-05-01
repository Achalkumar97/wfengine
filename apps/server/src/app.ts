import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { OpenAPIV3_1 } from "openapi-types";
import type { PrismaClient } from "@prisma/client";
import type { WorkflowEngine } from "@wfengine/core";
import type { Queue } from "bullmq";
import type { JobPayload } from "./queue.js";
import { verifyApiKey } from "./auth.js";
import { openApiRoot } from "./openapi.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";
import { registerExecutionRoutes } from "./routes/executions.js";
import { registerHookRoutes } from "./routes/hooks.js";
import { registerCronRoutes } from "./routes/cron.js";
import { registerRunsInlineRoutes } from "./routes/runs-inline.js";

export async function buildApp(deps: {
  prisma: PrismaClient;
  engine: WorkflowEngine;
  queue: Queue<JobPayload>;
  apiKey?: string | undefined;
}): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  await app.register(swagger, {
    openapi: openApiRoot as Partial<OpenAPIV3_1.Document>,
  });

  const auth = verifyApiKey(deps.apiKey);
  app.addHook("preHandler", auth);

  await registerWorkflowRoutes(app, deps.prisma);
  await registerExecutionRoutes(app, deps);
  await registerHookRoutes(app, deps);
  await registerCronRoutes(app, deps.prisma, deps.queue);
  await registerRunsInlineRoutes(app, deps.engine);

  app.get("/health", async () => ({ ok: true }));

  await app.register(swaggerUi, {
    routePrefix: "/api-docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });

  return app;
}
