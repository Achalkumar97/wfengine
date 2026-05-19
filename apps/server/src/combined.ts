/**
 * Combined API + Worker process
 * Runs both the Fastify server and BullMQ worker in one Node.js process.
 * Recommended for cost-effective Railway deployment.
 */
import { Worker } from "bullmq";
import { loadEnv } from "./env.js";
import { prisma } from "./prisma.js";
import { createServerEngine } from "./engine-factory.js";
import { createQueue } from "./queue.js";
import { buildApp } from "./app.js";
import { executeExecutionRecord, executeSync } from "./run-workflow.js";
import { QUEUE_NAME, type JobPayload } from "./queue.js";
import { ExecutionEventBus } from "./execution-event-bus.js";
import { ExecutionRepository } from "./execution-repository.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const engine = createServerEngine();
  const queue = createQueue(env.REDIS_URL);

  // Initialize the event bus before starting the server or worker
  ExecutionEventBus.init(env.REDIS_URL);

  const repo = new ExecutionRepository(prisma);

  // Start API Server
  const app = await buildApp({
    prisma,
    engine,
    queue,
    apiKey: env.API_KEY,
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`[combined] API Server listening on port ${env.PORT}`);

  // Start Worker in the same process
  const worker = new Worker<JobPayload>(
    QUEUE_NAME,
    async (job) => {
      const data = job.data;

      if (data.type === "execute") {
        const { executionId } = data;

        // Check for cancellation before starting
        const status = await repo.getExecutionStatus(executionId);
        if (!status) {
          console.warn(`[worker] Execution not found, skipping: ${executionId}`);
          return;
        }
        if (status.status === "cancelled") {
          console.info(`[worker] Execution cancelled before start: ${executionId}`);
          return;
        }

        console.info(`[worker] Starting execution: ${executionId}`);
        await executeExecutionRecord(prisma, engine, executionId);
        console.info(`[worker] Execution complete: ${executionId}`);
        return;
      }

      if (data.type === "cronTick") {
        await executeSync(prisma, engine, data.workflowVersionId, {
          cron: true,
          firedAt: new Date().toISOString(),
        });
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 5,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, {
      jobId: job?.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  worker.on("error", (err) => {
    console.error("[worker] Worker error:", err);
  });

  worker.on("stalled", (jobId) => {
    console.warn(`[worker] Job stalled: ${jobId}`);
  });

  console.log(`[combined] Worker listening on queue ${QUEUE_NAME}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[combined] Received ${signal}, shutting down gracefully...`);
    await worker.close();
    await app.close();
    await ExecutionEventBus.get().close();
    await prisma.$disconnect();
    console.log("[combined] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("[combined] Fatal startup error:", e);
  process.exit(1);
});
