/**
 * useAsyncRun — React hook for async workflow execution via POST /runs + SSE.
 *
 * Flow:
 *   1. POST /runs → get executionId immediately
 *   2. Subscribe to GET /runs/:id/stream (SSE) for live events
 *   3. Fall back to polling if SSE fails
 *   4. Reconstruct LiveRunStep[] from node_started/node_completed events
 *   5. Fetch final result from GET /runs/:id when execution completes
 *
 * Keeps /runs/inline/stream intact for backward compatibility.
 */
import type { WorkflowExecuteResult } from "@wfengine/core";
import { useCallback, useRef, useState } from "react";
import type { LiveRunStep } from "./RunInspectorPanel.js";
import {
  startAsyncRun,
  subscribeToExecutionStream,
  pollExecutionStatus,
  getExecutionStatus,
  cancelExecution,
  type ExecutionEventData,
} from "./server-api.js";

export type AsyncRunState =
  | { phase: "idle" }
  | { phase: "queued"; executionId: string }
  | { phase: "running"; executionId: string; progressPercent?: number }
  | {
      phase: "completed";
      executionId: string;
      result: WorkflowExecuteResult;
    }
  | { phase: "failed"; executionId: string; error: string }
  | { phase: "cancelled"; executionId: string };

export interface UseAsyncRunOptions {
  /** Called when a node_started event arrives. */
  onNodeStarted?: (nodeId: string, nodeType: string) => void;
  /** Called when a node_completed event arrives. */
  onNodeCompleted?: (nodeId: string, nodeType: string, ok: boolean, error?: string) => void;
  /** Called when the execution reaches a terminal state. */
  onFinished?: (state: AsyncRunState) => void;
}

export interface UseAsyncRunReturn {
  state: AsyncRunState;
  liveSteps: LiveRunStep[];
  /** Start an async run. Returns the executionId. */
  start: (params: {
    definition?: unknown;
    workflowVersionId?: string;
    initialData?: unknown;
    agentLibrary?: unknown;
    singleNodeRun?: { nodeId: string; seedOutputs: Record<string, unknown> };
    /** Ordered node list for initialising liveSteps. */
    orderedNodes?: Array<{ id: string; type: string }>;
  }) => Promise<string>;
  /** Cancel the current execution. */
  cancel: () => Promise<void>;
  /** Reset to idle state. */
  reset: () => void;
}

export function useAsyncRun(opts: UseAsyncRunOptions = {}): UseAsyncRunReturn {
  const [state, setState] = useState<AsyncRunState>({ phase: "idle" });
  const [liveSteps, setLiveSteps] = useState<LiveRunStep[]>([]);

  // Cleanup ref — holds the unsubscribe/stop-poll function
  const cleanupRef = useRef<(() => void) | null>(null);
  const currentExecutionIdRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    currentExecutionIdRef.current = null;
    setState({ phase: "idle" });
    setLiveSteps([]);
  }, []);

  const handleEvent = useCallback(
    (event: ExecutionEventData, executionId: string) => {
      switch (event.type) {
        case "execution_started":
          setState({ phase: "running", executionId });
          break;

        case "node_started": {
          const { nodeId, nodeType = "?" } = event;
          if (!nodeId) break;
          setLiveSteps((prev) =>
            prev.map((s) =>
              s.nodeId === nodeId ? { ...s, status: "running" } : s,
            ),
          );
          opts.onNodeStarted?.(nodeId, nodeType);
          break;
        }

        case "node_completed": {
          const { nodeId, nodeType = "?", ok = true, error } = event;
          if (!nodeId) break;
          setLiveSteps((prev) =>
            prev.map((s) =>
              s.nodeId === nodeId
                ? { ...s, status: ok ? "ok" : "failed", error }
                : s,
            ),
          );
          opts.onNodeCompleted?.(nodeId, nodeType, ok, error);
          break;
        }

        case "execution_completed":
        case "execution_failed":
          // Terminal state handled in onEnd callback
          break;

        default:
          break;
      }
    },
    [opts],
  );

  const handleEnd = useCallback(
    async (
      terminalStatus: "completed" | "failed" | "cancelled",
      executionId: string,
    ) => {
      cleanupRef.current?.();
      cleanupRef.current = null;

      if (terminalStatus === "cancelled") {
        const nextState: AsyncRunState = { phase: "cancelled", executionId };
        setState(nextState);
        setLiveSteps([]);
        opts.onFinished?.(nextState);
        return;
      }

      // Fetch final status to get error message or reconstruct result
      try {
        const status = await getExecutionStatus(executionId);

        if (terminalStatus === "failed" || status.status === "failed") {
          const nextState: AsyncRunState = {
            phase: "failed",
            executionId,
            error: status.error ?? "Workflow execution failed",
          };
          setState(nextState);
          opts.onFinished?.(nextState);
          return;
        }

        // Build a minimal WorkflowExecuteResult from status for the UI
        // The full result is in the DB — fetch it via GET /runs/:id if needed
        const result: WorkflowExecuteResult = {
          status: "completed",
          executionId,
          workflowId: status.workflowId ?? "",
          outputs: {},
          errors: {},
          startedAt: status.startedAt ?? new Date().toISOString(),
          finishedAt: status.completedAt ?? new Date().toISOString(),
        };

        const nextState: AsyncRunState = {
          phase: "completed",
          executionId,
          result,
        };
        setState(nextState);
        setLiveSteps([]);
        opts.onFinished?.(nextState);
      } catch {
        const nextState: AsyncRunState = {
          phase: "failed",
          executionId,
          error: "Failed to fetch execution result",
        };
        setState(nextState);
        opts.onFinished?.(nextState);
      }
    },
    [opts],
  );

  const start = useCallback(
    async (params: {
      definition?: unknown;
      workflowVersionId?: string;
      initialData?: unknown;
      agentLibrary?: unknown;
      singleNodeRun?: { nodeId: string; seedOutputs: Record<string, unknown> };
      orderedNodes?: Array<{ id: string; type: string }>;
    }): Promise<string> => {
      // Cancel any in-flight run
      cleanupRef.current?.();
      cleanupRef.current = null;

      const orderedNodes = params.orderedNodes ?? [];

      // Initialise live steps as pending
      setLiveSteps(
        orderedNodes.map((n) => ({
          nodeId: n.id,
          nodeType: n.type,
          status: "pending" as const,
        })),
      );

      // POST /runs
      const { executionId } = await startAsyncRun({
        definition: params.definition,
        workflowVersionId: params.workflowVersionId,
        initialData: params.initialData,
        agentLibrary: params.agentLibrary,
        singleNodeRun: params.singleNodeRun,
      });

      currentExecutionIdRef.current = executionId;
      setState({ phase: "queued", executionId });

      // Subscribe to SSE stream
      let sseWorking = false;

      const unsubscribe = subscribeToExecutionStream(
        executionId,
        (event) => {
          sseWorking = true;
          handleEvent(event, executionId);
        },
        (terminalStatus) => {
          void handleEnd(terminalStatus, executionId);
        },
        (err) => {
          // SSE failed — fall back to polling
          if (!sseWorking) {
            console.warn("[useAsyncRun] SSE failed, falling back to polling:", err.message);
            const stopPoll = pollExecutionStatus(
              executionId,
              (status) => {
                setState({
                  phase: "running",
                  executionId,
                  progressPercent: status.progressPercent,
                });
                if (status.currentNodeId) {
                  setLiveSteps((prev) =>
                    prev.map((s) =>
                      s.nodeId === status.currentNodeId
                        ? { ...s, status: "running" }
                        : s,
                    ),
                  );
                }
              },
              (terminalStatus) => {
                void handleEnd(terminalStatus, executionId);
              },
            );
            cleanupRef.current = stopPoll;
          }
        },
      );

      cleanupRef.current = unsubscribe;
      return executionId;
    },
    [handleEvent, handleEnd],
  );

  const cancel = useCallback(async () => {
    const executionId = currentExecutionIdRef.current;
    if (!executionId) return;

    cleanupRef.current?.();
    cleanupRef.current = null;

    try {
      await cancelExecution(executionId);
    } catch {
      /* best-effort */
    }

    setState({ phase: "cancelled", executionId });
    setLiveSteps([]);
  }, []);

  return { state, liveSteps, start, cancel, reset };
}
