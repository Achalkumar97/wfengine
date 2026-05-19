/**
 * ExecutionRepository — thin persistence layer over Prisma for execution lifecycle.
 *
 * Centralises all Execution DB writes so route handlers and the worker
 * never call prisma.execution directly for state transitions.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ExecutionEvent } from "./execution-event-bus.js";

export type ExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface CreateExecutionParams {
  workflowVersionId: string;
  initialData?: unknown;
  /** Inline definition JSON (for /runs async path — no persisted version) */
  inlineDefinition?: unknown;
}

export interface ExecutionRecord {
  id: string;
  workflowVersionId: string;
  status: string;
  initialData: unknown;
  result: unknown;
  errorSummary: string | null;
  logs: unknown;
  queued: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt?: Date;
}

/** Safely serialise any value to a Prisma-compatible InputJsonValue. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class ExecutionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createExecution(params: CreateExecutionParams): Promise<ExecutionRecord> {
    const logsPayload: Record<string, unknown> = { events: [] };
    if (params.inlineDefinition !== undefined) {
      logsPayload.inlineDefinition = params.inlineDefinition;
    }

    const record = await this.prisma.execution.create({
      data: {
        workflowVersionId: params.workflowVersionId,
        status: "queued" satisfies ExecutionStatus,
        queued: true,
        initialData:
          params.initialData !== undefined && params.initialData !== null
            ? toJson(params.initialData)
            : Prisma.JsonNull,
        logs: toJson(logsPayload),
      },
    });
    return record as ExecutionRecord;
  }

  async markExecutionRunning(executionId: string): Promise<void> {
    await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status: "running" satisfies ExecutionStatus,
        queued: false,
        startedAt: new Date(),
      },
    });
  }

  async markExecutionCompleted(
    executionId: string,
    result: unknown,
  ): Promise<void> {
    await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status: "completed" satisfies ExecutionStatus,
        result: toJson(result),
        finishedAt: new Date(),
        errorSummary: null,
      },
    });
  }

  async markExecutionFailed(
    executionId: string,
    error: string,
    result?: unknown,
  ): Promise<void> {
    await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status: "failed" satisfies ExecutionStatus,
        errorSummary: error,
        finishedAt: new Date(),
        ...(result !== undefined ? { result: toJson(result) } : {}),
      },
    });
  }

  async markExecutionCancelled(executionId: string): Promise<void> {
    await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status: "cancelled" satisfies ExecutionStatus,
        finishedAt: new Date(),
      },
    });
  }

  /**
   * Merge progress fields into the logs JSON column.
   * Reads current logs, patches the fields, writes back.
   */
  async updateExecution(
    executionId: string,
    fields: {
      currentNodeId?: string;
      currentAgentName?: string;
      progressPercent?: number;
    },
  ): Promise<void> {
    const existing = await this.prisma.execution.findUnique({
      where: { id: executionId },
      select: { logs: true },
    });

    const prev = (existing?.logs as Record<string, unknown> | null) ?? {};
    const merged: Record<string, unknown> = { ...prev };
    if (fields.currentNodeId !== undefined) merged.currentNodeId = fields.currentNodeId;
    if (fields.currentAgentName !== undefined) merged.currentAgentName = fields.currentAgentName;
    if (fields.progressPercent !== undefined) merged.progressPercent = fields.progressPercent;

    await this.prisma.execution.update({
      where: { id: executionId },
      data: { logs: toJson(merged) },
    });
  }

  /**
   * Append a structured event to the execution's event log (logs.events[]).
   * Capped at 2000 entries to prevent unbounded growth.
   */
  async appendExecutionEvent(
    executionId: string,
    event: ExecutionEvent,
  ): Promise<void> {
    const existing = await this.prisma.execution.findUnique({
      where: { id: executionId },
      select: { logs: true },
    });

    const prev = (existing?.logs as Record<string, unknown> | null) ?? {};
    const events: unknown[] = Array.isArray(prev.events) ? [...prev.events] : [];

    if (events.length >= 2000) events.shift();
    events.push(event);

    await this.prisma.execution.update({
      where: { id: executionId },
      data: { logs: toJson({ ...prev, events }) },
    });
  }

  async getExecution(executionId: string): Promise<ExecutionRecord | null> {
    const record = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: { workflowVersion: { include: { workflow: true } } },
    });
    return record as ExecutionRecord | null;
  }

  async getExecutionEvents(executionId: string): Promise<ExecutionEvent[]> {
    const record = await this.prisma.execution.findUnique({
      where: { id: executionId },
      select: { logs: true },
    });
    if (!record) return [];
    const logs = record.logs as Record<string, unknown> | null;
    if (!logs || !Array.isArray(logs.events)) return [];
    return logs.events as ExecutionEvent[];
  }

  async getExecutionStatus(executionId: string): Promise<{
    executionId: string;
    status: string;
    progressPercent?: number;
    currentNodeId?: string;
    currentAgentName?: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    errorSummary: string | null;
    workflowId?: string;
  } | null> {
    const record = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: { workflowVersion: { include: { workflow: true } } },
    });
    if (!record) return null;

    const logs = (record.logs as Record<string, unknown> | null) ?? {};
    const wv = (
      record as unknown as {
        workflowVersion?: { workflow?: { id?: string } };
      }
    ).workflowVersion;

    return {
      executionId: record.id,
      status: record.status,
      progressPercent:
        typeof logs.progressPercent === "number" ? logs.progressPercent : undefined,
      currentNodeId:
        typeof logs.currentNodeId === "string" ? logs.currentNodeId : undefined,
      currentAgentName:
        typeof logs.currentAgentName === "string" ? logs.currentAgentName : undefined,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      errorSummary: record.errorSummary,
      workflowId: wv?.workflow?.id,
    };
  }

  /** Retrieve the inline definition stored at creation time (for /runs async path). */
  async getInlineDefinition(executionId: string): Promise<unknown | null> {
    const record = await this.prisma.execution.findUnique({
      where: { id: executionId },
      select: { logs: true },
    });
    if (!record) return null;
    const logs = record.logs as Record<string, unknown> | null;
    return logs?.inlineDefinition ?? null;
  }
}
