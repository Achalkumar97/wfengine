import type { PrismaClient } from "@prisma/client";
import { parseWorkflow } from "@wfengine/shared";
import type { WorkflowEngine } from "@wfengine/core";

/**
 * Load workflow version JSON and run engine; updates Execution row.
 */
export async function executeExecutionRecord(
  prisma: PrismaClient,
  engine: WorkflowEngine,
  executionId: string,
): Promise<void> {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: { workflowVersion: true },
  });

  if (!execution) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  const definition = parseWorkflow(execution.workflowVersion.definitionJson);
  const initialData = execution.initialData ?? undefined;

  await prisma.execution.update({
    where: { id: executionId },
    data: {
      status: "running",
      queued: false,
      startedAt: new Date(),
    },
  });

  try {
    const result = await engine.execute(definition, initialData, {
      executionId,
    });

    const failed = result.status === "failed" || result.status === "partial";
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: failed ? "failed" : "completed",
        result: JSON.parse(JSON.stringify(result)) as object,
        finishedAt: new Date(),
        errorSummary:
          Object.keys(result.errors).length > 0
            ? JSON.stringify(result.errors)
            : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: "failed",
        errorSummary: message,
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

/** Create execution row and run immediately (no queue) */
export async function executeSync(
  prisma: PrismaClient,
  engine: WorkflowEngine,
  workflowVersionId: string,
  initialData: unknown,
): Promise<string> {
  const execution = await prisma.execution.create({
    data: {
      workflowVersionId,
      status: "queued",
      initialData:
        initialData === undefined
          ? undefined
          : (JSON.parse(JSON.stringify(initialData)) as object),
      queued: false,
    },
  });

  await executeExecutionRecord(prisma, engine, execution.id);
  return execution.id;
}
