/**
 * ExecutionEventBus — Redis pub/sub bridge for live execution progress.
 *
 * Publisher side: worker calls `publish(executionId, event)` as nodes run.
 * Subscriber side: SSE route subscribes per-executionId and forwards to client.
 *
 * Uses two ioredis connections (one for pub, one for sub) as required by Redis
 * pub/sub semantics (a subscribed connection cannot issue other commands).
 */
import { Redis } from "ioredis";

export type ExecutionEventType =
  | "execution_queued"
  | "execution_started"
  | "execution_completed"
  | "execution_failed"
  | "node_started"
  | "node_completed"
  | "agent_turn_started"
  | "agent_turn_completed"
  | "tool_call_started"
  | "tool_call_completed"
  | "openai_call_started"
  | "openai_call_completed"
  | "log";

export interface BaseExecutionEvent {
  type: ExecutionEventType;
  executionId: string;
  workflowId?: string;
  timestamp: string;
}

export interface ExecutionQueuedEvent extends BaseExecutionEvent {
  type: "execution_queued";
}

export interface ExecutionStartedEvent extends BaseExecutionEvent {
  type: "execution_started";
  startedAt: string;
}

export interface ExecutionCompletedEvent extends BaseExecutionEvent {
  type: "execution_completed";
  completedAt: string;
  status: "completed" | "partial";
  outputs?: Record<string, unknown>;
}

export interface ExecutionFailedEvent extends BaseExecutionEvent {
  type: "execution_failed";
  failedAt: string;
  error: string;
}

export interface NodeStartedEvent extends BaseExecutionEvent {
  type: "node_started";
  nodeId: string;
  nodeType: string;
}

export interface NodeCompletedEvent extends BaseExecutionEvent {
  type: "node_completed";
  nodeId: string;
  nodeType: string;
  ok: boolean;
  error?: string;
  durationMs?: number;
}

export interface AgentTurnStartedEvent extends BaseExecutionEvent {
  type: "agent_turn_started";
  nodeId: string;
  agentName: string;
  turn: number;
}

export interface AgentTurnCompletedEvent extends BaseExecutionEvent {
  type: "agent_turn_completed";
  nodeId: string;
  agentName: string;
  turn: number;
  durationMs?: number;
}

export interface ToolCallStartedEvent extends BaseExecutionEvent {
  type: "tool_call_started";
  nodeId: string;
  agentName?: string;
  toolCallId: string;
  toolName: string;
  toolIndex: number;
  turn: number;
}

export interface ToolCallCompletedEvent extends BaseExecutionEvent {
  type: "tool_call_completed";
  nodeId: string;
  agentName?: string;
  toolCallId: string;
  toolName: string;
  toolIndex: number;
  turn: number;
  ok: boolean;
  durationMs?: number;
  error?: string;
}

export interface OpenAiCallStartedEvent extends BaseExecutionEvent {
  type: "openai_call_started";
  nodeId: string;
  agentName?: string;
  turn: number;
  model: string;
  provider: string;
}

export interface OpenAiCallCompletedEvent extends BaseExecutionEvent {
  type: "openai_call_completed";
  nodeId: string;
  agentName?: string;
  turn: number;
  model: string;
  provider: string;
  durationMs: number;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LogEvent extends BaseExecutionEvent {
  type: "log";
  level: "debug" | "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
}

export type ExecutionEvent =
  | ExecutionQueuedEvent
  | ExecutionStartedEvent
  | ExecutionCompletedEvent
  | ExecutionFailedEvent
  | NodeStartedEvent
  | NodeCompletedEvent
  | AgentTurnStartedEvent
  | AgentTurnCompletedEvent
  | ToolCallStartedEvent
  | ToolCallCompletedEvent
  | OpenAiCallStartedEvent
  | OpenAiCallCompletedEvent
  | LogEvent;

function channelFor(executionId: string): string {
  return `wfengine:exec:${executionId}`;
}

/**
 * Singleton event bus. Call `ExecutionEventBus.init(redisUrl)` once at startup.
 */
export class ExecutionEventBus {
  private static instance: ExecutionEventBus | null = null;

  private readonly pub: Redis;
  private readonly sub: Redis;

  /** Local in-process listeners keyed by executionId (for same-process combined mode). */
  private readonly localListeners = new Map<
    string,
    Set<(event: ExecutionEvent) => void>
  >();

  private constructor(redisUrl: string) {
    this.pub = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: null });
    this.sub = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: null });

    this.sub.on("message", (channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as ExecutionEvent;
        const executionId = event.executionId;
        const listeners = this.localListeners.get(executionId);
        if (listeners) {
          for (const fn of listeners) {
            try {
              fn(event);
            } catch {
              /* listener errors must not crash the bus */
            }
          }
        }
      } catch {
        /* malformed message — ignore */
      }
    });
  }

  static init(redisUrl: string): ExecutionEventBus {
    if (!ExecutionEventBus.instance) {
      ExecutionEventBus.instance = new ExecutionEventBus(redisUrl);
    }
    return ExecutionEventBus.instance;
  }

  static get(): ExecutionEventBus {
    if (!ExecutionEventBus.instance) {
      throw new Error(
        "ExecutionEventBus not initialized. Call ExecutionEventBus.init(redisUrl) at startup.",
      );
    }
    return ExecutionEventBus.instance;
  }

  /** Publish an event to all subscribers of this executionId. */
  async publish(event: ExecutionEvent): Promise<void> {
    const channel = channelFor(event.executionId);
    const payload = JSON.stringify(event);
    await this.pub.publish(channel, payload);
  }

  /**
   * Subscribe to all events for a given executionId.
   * Returns an unsubscribe function — call it when the SSE connection closes.
   */
  subscribe(
    executionId: string,
    listener: (event: ExecutionEvent) => void,
  ): () => void {
    const channel = channelFor(executionId);

    if (!this.localListeners.has(executionId)) {
      this.localListeners.set(executionId, new Set());
      // Subscribe to Redis channel only once per executionId
      void this.sub.subscribe(channel);
    }

    this.localListeners.get(executionId)!.add(listener);

    return () => {
      const set = this.localListeners.get(executionId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) {
        this.localListeners.delete(executionId);
        void this.sub.unsubscribe(channel);
      }
    };
  }

  async close(): Promise<void> {
    await this.pub.quit();
    await this.sub.quit();
  }
}
