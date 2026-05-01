import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Queue } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import cron from "node-cron";
import type { JobPayload } from "../queue.js";

const RegisterBody = z.object({
  expression: z.string().min(1),
});

/**
 * Registers BullMQ repeatable jobs (requires Redis). Validates cron with node-cron.
 */
export async function registerCronRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  queue: Queue<JobPayload>,
): Promise<void> {
  app.post<{ Params: { versionId: string } }>(
    "/workflow-versions/:versionId/cron",
    async (request, reply) => {
      const { versionId } = request.params;
      const body = RegisterBody.parse(request.body);

      if (!cron.validate(body.expression)) {
        reply.status(400).send({ error: "Invalid cron expression" });
        return;
      }

      const ver = await prisma.workflowVersion.findUnique({
        where: { id: versionId },
      });
      if (!ver) {
        reply.status(404).send({ error: "Workflow version not found" });
        return;
      }

      await queue.add(
        "cronTick",
        { type: "cronTick", workflowVersionId: versionId },
        {
          repeat: { pattern: body.expression },
          jobId: `cron-${versionId}`,
        },
      );

      reply.status(201).send({ ok: true, workflowVersionId: versionId, expression: body.expression });
    },
  );

  app.delete<{ Params: { versionId: string } }>(
    "/workflow-versions/:versionId/cron",
    async (request, reply) => {
      const { versionId } = request.params;
      const jobs = await queue.getRepeatableJobs();
      const jobId = `cron-${versionId}`;
      const match = jobs.find((j) => j.id === jobId || j.key.includes(versionId));
      if (match?.key) {
        await queue.removeRepeatableByKey(match.key);
      }
      reply.send({ removed: !!match });
    },
  );
}
