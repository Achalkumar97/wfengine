import cron from "node-cron";
import type { NodeDefinition } from "@wfengine/core";
import type { WorkflowEngine } from "@wfengine/core";
import type { WorkflowDefinition } from "@wfengine/shared";
import type { ExecuteOptions } from "@wfengine/core";
import { z } from "zod";
import { CronTriggerConfigSchema } from "./config-schemas.js";

export { CronTriggerConfigSchema } from "./config-schemas.js";

export const cronTriggerNode: NodeDefinition = {
  type: "trigger.cron",
  label: "Cron trigger",
  category: "trigger",
  configSchema: CronTriggerConfigSchema,
  description:
    "When executed directly, emits tick metadata. Prefer scheduling via server BullMQ in production.",
  execute: async ({ config }) => {
    const c = config as z.infer<typeof CronTriggerConfigSchema>;
    return {
      cron: true,
      expression: c.expression,
      firedAt: new Date().toISOString(),
    };
  },
};

export interface CronScheduleHandle {
  stop: () => void;
}

/**
 * Schedule workflow execution on a cron expression (in-process). For production,
 * use the server's BullMQ repeatable jobs instead.
 */
export function scheduleWorkflowCron(
  engine: WorkflowEngine,
  workflow: WorkflowDefinition,
  expression: string,
  options?: ExecuteOptions,
): CronScheduleHandle {
  if (!cron.validate(expression)) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }
  const task = cron.schedule(expression, async () => {
    await engine.execute(
      workflow,
      { scheduled: true, at: new Date().toISOString() },
      options,
    );
  });

  return {
    stop: () => {
      task.stop();
    },
  };
}
