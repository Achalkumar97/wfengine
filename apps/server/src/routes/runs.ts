/**
 * POST /runs — async workflow execution endpoint.
 *
 * Accepts a workflow definition (inline) or a workflowVersionId, creates an
 * Execution record, enqueues a BullMQ job, and immediately returns the
 * executionId so the client can subscribe to live updates via SSE.
 *
 * This replaces the synchronous /runs/inline/stream pattern for production use.
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import { z } from "zod";
import {
  RunInlineDefinitionBodySchema,
  WorkflowDefinitionSchema,
} from "@wfengine/shared";
import type { JobPayload } from "../queue.js";
import { ExecutionRepository } from "../execution-repository.js";
import { ExecutionEventBus } from "../execution-event-bus.js";

/**
 * Body schema for POST /runs.
 * Supports two modes:
 *   1. Inline definition (Studio / dev): provide `definition` directly.
 *   2. Persisted version: provide `workflowVersionId`.
 */
const RunBodySchema = z
  .object({
    /** Inline workflow definition (no DB version required). */
    definition: WorkflowDefinitionSchema.optional(),
    /** Persisted workflow version id. */
    workflowVersionId: z.string().uuid().optional(),
    /** Initial data passed to the first node(s). */
    initialData: z.unknown().optional(),
    /** Agent library for library_agent tool resolution. */
    agentLibrary: RunInlineDefinitionBodySchema.shape.agentLibrary,
    /** Single-node re-run (only valid with inline definition). */
    singleNodeRun: RunInlineDefinitionBodySchema.shape.singleNodeRun,
  })
  .refine(
    (d) => d.definition !== undefined || d.workflowVersionId !== undefined,
    {
      message: "Provide either `definition` (inline) or `workflowVersionId`",
    },
  );

export type RunBody = z.infer<typeof RunBodySchema>;

export async function registerRunsRoutes(
  app: FastifyInstance,
  deps: {
    prisma: PrismaClient;
    queue: Queue<JobPayload>;
  },
): Promise<void> {
  const { prisma, queue } = deps;

  /**
   * POST /runs
   * Creates an async execution and returns { executionId, status: "queued" } immediately.
   * The worker picks up the job and executes the workflow.
   * Subscribe to GET /runs/:executionId/events (SSE) for live progress.
   */
  app.post("/runs", async (request, reply) => {
    const body = RunBodySchema.parse(request.body);
    const repo = new ExecutionRepository(prisma);

    let workflowVersionId: string;
    let inlineDefinition: unknown | undefined;

    if (body.workflowVersionId) {
      // Persisted version path
      const ver = await prisma.workflowVersion.findUnique({
        where: { id: body.workflowVersionId },
      });
      if (!ver) {
        return reply.status(404).send({ error: "Workflow version not found" });
      }
      workflowVersionId = body.workflowVersionId;
    } else {
      // Inline definition path — we need a placeholder WorkflowVersion row
      // because the Execution model requires a workflowVersionId FK.
      // We use a sentinel workflow + version for inline runs.
      const sentinelWorkflow = await getOrCreateInlineSentinelWorkflow(prisma);
      const ver = await prisma.workflowVersion.create({
        data: {
          workflowId: sentinelWorkflow.id,
          versionNumber: await nextInlineVersionNumber(prisma, sentinelWorkflow.id),
          definitionJson: JSON.parse(
            JSON.stringify(body.definition),
          ) as object,
          label: "inline-async",
        },
      });
      workflowVersionId = ver.id;
      inlineDefinition = body.definition;
    }

    // Build the initial data, merging agentLibrary and singleNodeRun into logs
    const initialData = body.initialData;

    const execution = await repo.createExecution({
      workflowVersionId,
      initialData,
      inlineDefinition: inlineDefinition
        ? {
            definition: inlineDefinition,
            agentLibrary: body.agentLibrary,
            singleNodeRun: body.singleNodeRun,
          }
        : undefined,
    });

    // Publish queued event (best-effort)
    try {
      const bus = ExecutionEventBus.get();
      await bus.publish({
        type: "execution_queued",
        executionId: execution.id,
        timestamp: new Date().toISOString(),
      });
    } catch {
      /* event bus may not be initialized in test environments */
    }

    // Enqueue the job
    await queue.add(
      "execute",
      { type: "execute", executionId: execution.id },
      {
        jobId: execution.id,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    );

    return reply.status(202).send({
      executionId: execution.id,
      status: "queued",
      createdAt: new Date().toISOString(),
    });
  });

  /**
   * GET /runs/:executionId
   * Returns the current execution status, progress, and result.
   */
  app.get<{ Params: { executionId: string } }>(
    "/runs/:executionId",
    async (request, reply) => {
      const { executionId } = request.params;
      const repo = new ExecutionRepository(prisma);
      const status = await repo.getExecutionStatus(executionId);
      if (!status) {
        return reply.status(404).send({ error: "Execution not found" });
      }
      return reply.send(status);
    },
  );

  /**
   * GET /runs/:executionId/events
   * Returns all stored execution events (for polling fallback or replay).
   */
  app.get<{ Params: { executionId: string } }>(
    "/runs/:executionId/events",
    async (request, reply) => {
      const { executionId } = request.params;
      const repo = new ExecutionRepository(prisma);

      // Verify execution exists
      const status = await repo.getExecutionStatus(executionId);
      if (!status) {
        return reply.status(404).send({ error: "Execution not found" });
      }

      const events = await repo.getExecutionEvents(executionId);
      return reply.send({ executionId, events });
    },
  );

  /**
   * GET /runs/:executionId/status
   * Lightweight status-only endpoint for polling.
   */
  app.get<{ Params: { executionId: string } }>(
    "/runs/:executionId/status",
    async (request, reply) => {
      const { executionId } = request.params;
      const repo = new ExecutionRepository(prisma);
      const status = await repo.getExecutionStatus(executionId);
      if (!status) {
        return reply.status(404).send({ error: "Execution not found" });
      }
      return reply.send({
        executionId: status.executionId,
        status: status.status,
        progressPercent: status.progressPercent,
        currentNodeId: status.currentNodeId,
        currentAgentName: status.currentAgentName,
        startedAt: status.startedAt,
        completedAt: status.finishedAt,
        error: status.errorSummary,
      });
    },
  );

  /**
   * GET /runs/:executionId/stream
   * Server-Sent Events (SSE) stream for live execution progress.
   *
   * The client connects immediately after POST /runs and receives events
   * as the worker processes the workflow. On reconnect, missed events are
   * replayed from the DB before subscribing to live events.
   *
   * Event format: `data: <JSON>\n\n` (standard SSE)
   */
  app.get<{
    Params: { executionId: string };
    Querystring: { lastEventId?: string };
  }>("/runs/:executionId/stream", async (request, reply) => {
    const { executionId } = request.params;
    const repo = new ExecutionRepository(prisma);

    // Verify execution exists
    const status = await repo.getExecutionStatus(executionId);
    if (!status) {
      return reply.status(404).send({ error: "Execution not found" });
    }

    // Set SSE headers
    void reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });

    const sendEvent = (event: unknown, id?: string) => {
      const data = JSON.stringify(event);
      if (id) {
        reply.raw.write(`id: ${id}\n`);
      }
      reply.raw.write(`data: ${data}\n\n`);
    };

    const sendComment = () => {
      reply.raw.write(": keepalive\n\n");
    };

    // Replay stored events for reconnect support
    const storedEvents = await repo.getExecutionEvents(executionId);
    for (let i = 0; i < storedEvents.length; i++) {
      sendEvent(storedEvents[i], String(i));
    }

    // If execution is already terminal, send final status and close
    const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
    if (terminalStatuses.has(status.status)) {
      sendEvent({
        type: "stream_end",
        executionId,
        status: status.status,
        timestamp: new Date().toISOString(),
      });
      reply.raw.end();
      return reply;
    }

    // Subscribe to live events
    let bus: ExecutionEventBus | null = null;
    try {
      bus = ExecutionEventBus.get();
    } catch {
      /* no event bus — send current status and close */
      sendEvent({
        type: "stream_end",
        executionId,
        status: status.status,
        message: "Live events unavailable (no Redis event bus)",
        timestamp: new Date().toISOString(),
      });
      reply.raw.end();
      return reply;
    }

    let eventIndex = storedEvents.length;
    let unsubscribe: (() => void) | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      if (unsubscribe) unsubscribe();
    };

    request.raw.on("close", cleanup);
    request.raw.on("error", cleanup);

    // Keepalive ping every 15s to prevent proxy timeouts
    keepaliveTimer = setInterval(() => {
      if (closed) return;
      sendComment();
    }, 15_000);

    unsubscribe = bus.subscribe(executionId, (event) => {
      if (closed) return;
      sendEvent(event, String(eventIndex++));

      // Close stream when execution reaches terminal state
      const terminal =
        event.type === "execution_completed" ||
        event.type === "execution_failed";
      if (terminal) {
        sendEvent({
          type: "stream_end",
          executionId,
          status:
            event.type === "execution_completed" ? "completed" : "failed",
          timestamp: new Date().toISOString(),
        });
        cleanup();
        reply.raw.end();
      }
    });

    // Return hijacked reply (Fastify must not send its own response)
    return reply;
  });

  /**
   * DELETE /runs/:executionId
   * Request cancellation of a queued or running execution.
   * Sets status to "cancelled" — the worker checks this before/during execution.
   */
  app.delete<{ Params: { executionId: string } }>(
    "/runs/:executionId",
    async (request, reply) => {
      const { executionId } = request.params;
      const repo = new ExecutionRepository(prisma);

      const status = await repo.getExecutionStatus(executionId);
      if (!status) {
        return reply.status(404).send({ error: "Execution not found" });
      }

      if (status.status === "completed" || status.status === "failed") {
        return reply.status(409).send({
          error: `Cannot cancel execution in terminal state: ${status.status}`,
        });
      }

      await repo.markExecutionCancelled(executionId);

      // Remove from queue if still queued
      try {
        const job = await queue.getJob(executionId);
        if (job) {
          await job.remove();
        }
      } catch {
        /* job may already be processing — cancellation is best-effort */
      }

      try {
        const bus = ExecutionEventBus.get();
        await bus.publish({
          type: "execution_failed",
          executionId,
          failedAt: new Date().toISOString(),
          error: "Cancelled by user",
          timestamp: new Date().toISOString(),
        });
      } catch {
        /* best-effort */
      }

      return reply.send({ executionId, status: "cancelled" });
    },
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const INLINE_SENTINEL_WORKFLOW_NAME = "__wfengine_inline_runs__";

async function getOrCreateInlineSentinelWorkflow(
  prisma: PrismaClient,
): Promise<{ id: string }> {
  const existing = await prisma.workflow.findFirst({
    where: { name: INLINE_SENTINEL_WORKFLOW_NAME },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.workflow.create({
    data: {
      name: INLINE_SENTINEL_WORKFLOW_NAME,
      meta: { _internal: true, description: "Sentinel workflow for inline async runs" },
    },
    select: { id: true },
  });
}

async function nextInlineVersionNumber(
  prisma: PrismaClient,
  workflowId: string,
): Promise<number> {
  const latest = await prisma.workflowVersion.findFirst({
    where: { workflowId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  return (latest?.versionNumber ?? 0) + 1;
}
