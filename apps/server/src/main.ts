import { loadEnv } from "./env.js";
import { prisma } from "./prisma.js";
import { createServerEngine } from "./engine-factory.js";
import { createQueue } from "./queue.js";
import { buildApp } from "./app.js";
import { ExecutionEventBus } from "./execution-event-bus.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const engine = createServerEngine();
  const queue = createQueue(env.REDIS_URL);

  // Initialize event bus for SSE live updates
  ExecutionEventBus.init(env.REDIS_URL);

  const app = await buildApp({
    prisma,
    engine,
    queue,
    apiKey: env.API_KEY,
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });

  const shutdown = async (signal: string) => {
    console.log(`[server] Received ${signal}, shutting down...`);
    await app.close();
    await ExecutionEventBus.get().close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
