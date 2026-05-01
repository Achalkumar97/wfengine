import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { WorkflowEngine } from "@wfengine/core";
import type { Queue } from "bullmq";
import type { JobPayload } from "../queue.js";
import { executeExecutionRecord } from "../run-workflow.js";

/**
 * Webhook triggers a workflow version — body becomes initialData.
 */
export async function registerHookRoutes(
  app: FastifyInstance,
  deps: {
    prisma: PrismaClient;
    engine: WorkflowEngine;
    queue: Queue<JobPayload>;
  },
): Promise<void> {
  const { prisma, engine, queue } = deps;

  app.post<{ Params: { versionId: string }; Querystring: { async?: string } }>(
    "/hooks/by-version/:versionId",
    async (request, reply) => {
      const { versionId } = request.params;
      const asyncExec = request.query.async === "1" || request.query.async === "true";

      const ver = await prisma.workflowVersion.findUnique({
        where: { id: versionId },
      });
      if (!ver) {
        reply.status(404).send({ error: "Workflow version not found" });
        return;
      }

      const initialData = request.body ?? {};

      const execution = await prisma.execution.create({
        data: {
          workflowVersionId: versionId,
          status: "queued",
          queued: asyncExec,
          initialData:
            typeof initialData === "object" && initialData !== null
              ? (JSON.parse(JSON.stringify(initialData)) as object)
              : { payload: initialData },
        },
      });

      if (asyncExec) {
        await queue.add(
          "execute",
          { type: "execute", executionId: execution.id },
          { jobId: execution.id },
        );
        reply.status(202).send(execution);
        return;
      }

      await executeExecutionRecord(prisma, engine, execution.id);
      const done = await prisma.execution.findUnique({
        where: { id: execution.id },
      });
      reply.status(200).send(done);
    },
  );
}
