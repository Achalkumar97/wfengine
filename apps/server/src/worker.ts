/**
 * BullMQ worker — run alongside `main` in production (`npm run worker -w @wfengine/server`).
 *
 * Handles:
 *   - "execute" jobs: runs a persisted or inline workflow execution
 *   - "cronTick" jobs: fires a scheduled workflow version
 *
 * Features:
 *   - Publishes live events via ExecutionEventBus (Redis pub/sub)
 *   - Checks for cancellation before starting
 *   - Graceful shutdown on SIGTERM/SIGINT
 *   - Structured error logging
 */
import { Worker } from "bullmq";
import { prisma } from "./prisma.js";
import { createServerEngine } from "./engine-factory.js";
import { executeExecutionRecord, executeSync } from "./run-workflow.js";
import { QUEUE_NAME, type JobPayload } from "./queue.js";
import { loadEnv } from "./env.js";
import { ExecutionEventBus } from "./execution-event-bus.js";
import { ExecutionRepository } from "./execution-repository.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const engine = createServerEngine();

  // Initialize the event bus so executeExecutionRecord can publish events
  ExecutionEventBus.init(env.REDIS_URL);

  const repo = new ExecutionRepository(prisma);

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
        console.info(
          `[worker] Cron tick for version: ${data.workflowVersionId}`,
        );
        await executeSync(prisma, engine, data.workflowVersionId, {
          cron: true,
          firedAt: new Date().toISOString(),
        });
        return;
      }

      console.warn("[worker] Unknown job type:", (data as { type: string }).type);
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 5,
      // Stalled job detection: if a job doesn't heartbeat for 30s, re-queue it
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, {
      jobId: job?.id,
      jobType: job?.data?.type,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  });

  worker.on("error", (err) => {
    console.error("[worker] Worker error:", err);
  });

  worker.on("stalled", (jobId) => {
    console.warn(`[worker] Job stalled: ${jobId}`);
  });

  console.log(`[worker] Listening on queue: ${QUEUE_NAME} (concurrency: 5)`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[worker] Received ${signal}, shutting down gracefully...`);
    await worker.close();
    await ExecutionEventBus.get().close();
    await prisma.$disconnect();
    console.log("[worker] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("[worker] Fatal startup error:", e);
  process.exit(1);
});
