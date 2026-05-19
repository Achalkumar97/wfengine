import type { PrismaClient } from "@prisma/client";
import { parseWorkflow } from "@wfengine/shared";
import type { WorkflowEngine } from "@wfengine/core";
import { ExecutionRepository } from "./execution-repository.js";
import { ExecutionEventBus } from "./execution-event-bus.js";

/**
 * Load workflow version JSON and run engine; updates Execution row and publishes
 * live events to the ExecutionEventBus for SSE subscribers.
 */
export async function executeExecutionRecord(
  prisma: PrismaClient,
  engine: WorkflowEngine,
  executionId: string,
): Promise<void> {
  const repo = new ExecutionRepository(prisma);

  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: { workflowVersion: true },
  });

  if (!execution) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  // Resolve workflow definition — either from persisted version or inline
  let definition: ReturnType<typeof parseWorkflow>;
  if (execution.workflowVersion?.definitionJson) {
    definition = parseWorkflow(execution.workflowVersion.definitionJson);
  } else {
    // Inline definition stored in logs.inlineDefinition
    const inlineDef = await repo.getInlineDefinition(executionId);
    if (!inlineDef) {
      throw new Error(
        `Execution ${executionId} has no workflow version and no inline definition`,
      );
    }
    definition = parseWorkflow(inlineDef);
  }

  const initialData = execution.initialData ?? undefined;

  // Try to get the event bus — gracefully degrade if not initialized
  let bus: ExecutionEventBus | null = null;
  try {
    bus = ExecutionEventBus.get();
  } catch {
    /* event bus not initialized — running without live events */
  }

  const now = () => new Date().toISOString();

  await repo.markExecutionRunning(executionId);

  await bus?.publish({
    type: "execution_started",
    executionId,
    workflowId: definition.id,
    startedAt: now(),
    timestamp: now(),
  });

  // Track node timing for progress calculation
  const nodeCount = definition.nodes.length;
  let completedNodes = 0;
  const nodeStartTimes = new Map<string, number>();

  try {
    const result = await engine.execute(definition, initialData, {
      executionId,
      onNodeProgress: async (ev) => {
        if (ev.phase === "start") {
          nodeStartTimes.set(ev.nodeId, Date.now());

          await repo.updateExecution(executionId, {
            currentNodeId: ev.nodeId,
          });

          const event = {
            type: "node_started" as const,
            executionId,
            workflowId: definition.id,
            nodeId: ev.nodeId,
            nodeType: ev.nodeType,
            timestamp: now(),
          };
          await bus?.publish(event);
          await repo.appendExecutionEvent(executionId, event);
        } else {
          completedNodes++;
          const startTime = nodeStartTimes.get(ev.nodeId);
          const durationMs = startTime ? Date.now() - startTime : undefined;
          const progressPercent =
            nodeCount > 0
              ? Math.round((completedNodes / nodeCount) * 100)
              : 0;

          await repo.updateExecution(executionId, { progressPercent });

          const event = {
            type: "node_completed" as const,
            executionId,
            workflowId: definition.id,
            nodeId: ev.nodeId,
            nodeType: ev.nodeType,
            ok: ev.ok === true,
            error: ev.error,
            durationMs,
            timestamp: now(),
          };
          await bus?.publish(event);
          await repo.appendExecutionEvent(executionId, event);
        }
      },
    });

    const failed = result.status === "failed" || result.status === "partial";

    if (failed) {
      await repo.markExecutionFailed(
        executionId,
        Object.keys(result.errors).length > 0
          ? JSON.stringify(result.errors)
          : "Workflow completed with failures",
        result,
      );

      const event = {
        type: "execution_failed" as const,
        executionId,
        workflowId: definition.id,
        failedAt: now(),
        error:
          Object.keys(result.errors).length > 0
            ? JSON.stringify(result.errors)
            : "Workflow completed with failures",
        timestamp: now(),
      };
      await bus?.publish(event);
      await repo.appendExecutionEvent(executionId, event);
    } else {
      await repo.markExecutionCompleted(executionId, result);

      const event = {
        type: "execution_completed" as const,
        executionId,
        workflowId: definition.id,
        completedAt: now(),
        status: (result.status === "partial" ? "partial" : "completed") as "completed" | "partial",
        timestamp: now(),
      };
      await bus?.publish(event);
      await repo.appendExecutionEvent(executionId, event);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repo.markExecutionFailed(executionId, message);

    const event = {
      type: "execution_failed" as const,
      executionId,
      workflowId: definition.id,
      failedAt: now(),
      error: message,
      timestamp: now(),
    };
    await bus?.publish(event);
    try {
      await repo.appendExecutionEvent(executionId, event);
    } catch {
      /* best-effort */
    }
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
      logs: { events: [] },
    },
  });

  await executeExecutionRecord(prisma, engine, execution.id);
  return execution.id;
}
