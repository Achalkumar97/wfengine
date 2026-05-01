import { Queue } from "bullmq";

export const QUEUE_NAME = "wfengine-jobs";

export interface ExecuteJobPayload {
  type: "execute";
  executionId: string;
}

export interface CronTickPayload {
  type: "cronTick";
  workflowVersionId: string;
}

export type JobPayload = ExecuteJobPayload | CronTickPayload;

export function createQueue(redisUrl: string): Queue<JobPayload, void, string> {
  return new Queue<JobPayload>(QUEUE_NAME, {
    connection: { url: redisUrl },
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    },
  });
}
