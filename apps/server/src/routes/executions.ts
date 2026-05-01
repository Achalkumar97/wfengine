import type { FastifyInstance } from "fastify";
import { StartExecutionBodySchema } from "@wfengine/shared";
import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import type { WorkflowEngine } from "@wfengine/core";
import type { JobPayload } from "../queue.js";
import { executeExecutionRecord } from "../run-workflow.js";

export async function registerExecutionRoutes(
  app: FastifyInstance,
  deps: {
    prisma: PrismaClient;
    engine: WorkflowEngine;
    queue: Queue<JobPayload>;
  },
): Promise<void> {
  const { prisma, engine, queue } = deps;

  app.post("/executions", async (request, reply) => {
    const body = StartExecutionBodySchema.parse(request.body);

    const ver = await prisma.workflowVersion.findUnique({
      where: { id: body.workflowVersionId },
    });
    if (!ver) {
      reply.status(404).send({ error: "Workflow version not found" });
      return;
    }

    const execution = await prisma.execution.create({
      data: {
        workflowVersionId: body.workflowVersionId,
        status: "queued",
        queued: body.async === true,
        initialData:
          body.initialData === undefined
            ? undefined
            : (JSON.parse(JSON.stringify(body.initialData)) as object),
      },
    });

    if (body.async === true) {
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
    reply.status(201).send(done);
  });

  app.get("/executions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ex = await prisma.execution.findUnique({
      where: { id },
      include: { workflowVersion: { include: { workflow: true } } },
    });
    if (!ex) {
      reply.status(404).send({ error: "Not found" });
      return;
    }
    reply.send(ex);
  });
}
