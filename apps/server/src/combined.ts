/**
 * Combined API + Worker process
 * Runs both the Fastify server and BullMQ worker in one Node.js process
 * Recommended for cost-effective Railway deployment
 */
import { Worker } from "bullmq";
import { loadEnv } from "./env.js";
import { prisma } from "./prisma.js";
import { createServerEngine } from "./engine-factory.js";
import { createQueue } from "./queue.js";
import { buildApp } from "./app.js";
import {
  executeExecutionRecord,
  executeSync,
} from "./run-workflow.js";
import { QUEUE_NAME, type JobPayload } from "./queue.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const engine = createServerEngine();
  const queue = createQueue(env.REDIS_URL);

  // Start API Server
  const app = await buildApp({
    prisma,
    engine,
    queue,
    apiKey: env.API_KEY,
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`API Server listening on port ${env.PORT}`);

  // Start Worker in the same process
  const worker = new Worker<JobPayload>(
    QUEUE_NAME,
    async (job) => {
      const data = job.data;
      if (data.type === "execute") {
        await executeExecutionRecord(prisma, engine, data.executionId);
        return;
      }
      if (data.type === "cronTick") {
        await executeSync(prisma, engine, data.workflowVersionId, {
          cron: true,
          firedAt: new Date().toISOString(),
        });
      }
    },
    { connection: { url: env.REDIS_URL }, concurrency: 5 },
  );

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed`, err);
  });

  console.log(`Worker listening on queue ${QUEUE_NAME}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down gracefully...");
    await worker.close();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
