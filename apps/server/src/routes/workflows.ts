import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateWorkflowVersionBodySchema } from "@wfengine/shared";
import { Prisma, type PrismaClient } from "@prisma/client";

const CreateWorkflowBody = z.object({
  name: z.string().min(1),
  meta: z.record(z.unknown()).optional(),
});

export async function registerWorkflowRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): Promise<void> {
  app.get("/workflows", async (_request, reply) => {
    const wfs = await prisma.workflow.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
    });
    reply.send(wfs);
  });

  app.post("/workflows", async (request, reply) => {
    const body = CreateWorkflowBody.parse(request.body);
    const wf = await prisma.workflow.create({
      data: {
        name: body.name,
        meta:
          body.meta !== undefined
            ? (JSON.parse(JSON.stringify(body.meta)) as Prisma.InputJsonValue)
            : undefined,
      },
    });
    reply.status(201).send(wf);
  });

  app.get("/workflows/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const wf = await prisma.workflow.findUnique({
      where: { id },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
    });
    if (!wf) {
      reply.status(404).send({ error: "Not found" });
      return;
    }
    reply.send(wf);
  });

  app.post("/workflows/:id/versions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = CreateWorkflowVersionBodySchema.parse(request.body);

    const wf = await prisma.workflow.findUnique({ where: { id } });
    if (!wf) {
      reply.status(404).send({ error: "Workflow not found" });
      return;
    }

    const latest = await prisma.workflowVersion.findFirst({
      where: { workflowId: id },
      orderBy: { versionNumber: "desc" },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;

    const ver = await prisma.workflowVersion.create({
      data: {
        workflowId: id,
        versionNumber,
        definitionJson: JSON.parse(JSON.stringify(body.definition)) as object,
        label: body.label,
      },
    });

    reply.status(201).send(ver);
  });

  app.get("/workflow-versions/:versionId", async (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    const ver = await prisma.workflowVersion.findUnique({
      where: { id: versionId },
      include: { workflow: true },
    });
    if (!ver) {
      reply.status(404).send({ error: "Not found" });
      return;
    }
    reply.send(ver);
  });
}
