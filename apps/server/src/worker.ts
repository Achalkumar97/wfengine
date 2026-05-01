/**
 * BullMQ worker — run alongside `main` in production (`npm run worker -w @wfengine/server`).
 */
import { Worker } from "bullmq";
import { prisma } from "./prisma.js";
import { createServerEngine } from "./engine-factory.js";
import {
  executeExecutionRecord,
  executeSync,
} from "./run-workflow.js";
import { QUEUE_NAME, type JobPayload } from "./queue.js";
import { loadEnv } from "./env.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const engine = createServerEngine();

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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
