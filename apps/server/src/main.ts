import { loadEnv } from "./env.js";
import { prisma } from "./prisma.js";
import { createServerEngine } from "./engine-factory.js";
import { createQueue } from "./queue.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const engine = createServerEngine();
  const queue = createQueue(env.REDIS_URL);

  const app = await buildApp({
    prisma,
    engine,
    queue,
    apiKey: env.API_KEY,
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
