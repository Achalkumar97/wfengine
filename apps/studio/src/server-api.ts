type RuntimeStudioConfig = {
  VITE_WFENGINE_API?: string;
  VITE_WFENGINE_API_KEY?: string;
};

function runtimeConfig(): RuntimeStudioConfig {
  if (typeof window === "undefined") return {};
  return (
    (window as typeof window & {
      __WFENGINE_STUDIO_CONFIG__?: RuntimeStudioConfig;
    }).__WFENGINE_STUDIO_CONFIG__ ?? {}
  );
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function apiBase(): string {
  const raw = firstNonEmpty(
    runtimeConfig().VITE_WFENGINE_API,
    import.meta.env.VITE_WFENGINE_API,
  );
  const base = raw.replace(/\/$/, "");
  if (base && !/^https?:\/\//i.test(base)) {
    return `https://${base}`;
  }
  return base;
}

export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const key = firstNonEmpty(
    runtimeConfig().VITE_WFENGINE_API_KEY,
    import.meta.env.VITE_WFENGINE_API_KEY,
  );
  if (key) h["x-api-key"] = key;
  return h;
}

async function readJsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessageFromBody(status: number, body: unknown): string {
  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim().length > 0) {
      return o.message;
    }
    if (typeof o.error === "string" && o.error.length > 0) {
      return o.error;
    }
  }
  if (typeof body === "string" && body.trim().length > 0) return body;
  return `${status} ${status === 500 ? "Internal Server Error" : "Request failed"}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBase()}${path}`;
  const res = await fetch(url, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } });
  const body = await readJsonOrText(res);
  if (!res.ok) {
    const method = init?.method ?? "GET";
    throw new Error(`${method} ${url} failed: ${errorMessageFromBody(res.status, body)}`);
  }
  return body as T;
}

export type WorkflowRow = {
  id: string;
  name: string;
  meta?: unknown;
  createdAt?: string;
  updatedAt?: string;
  versions?: Array<{
    id: string;
    versionNumber: number;
    label?: string | null;
    createdAt?: string;
  }>;
};

export type WorkflowVersionRow = {
  id: string;
  workflowId: string;
  versionNumber: number;
  label?: string | null;
  definitionJson: unknown;
  createdAt?: string;
  workflow?: WorkflowRow;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parseWorkflowRow(value: unknown): WorkflowRow | null {
  const o = asRecord(value);
  if (!o || typeof o.id !== "string" || typeof o.name !== "string") {
    return null;
  }
  const versions = Array.isArray(o.versions)
    ? o.versions
        .map((v) => {
          const row = asRecord(v);
          if (
            !row ||
            typeof row.id !== "string" ||
            typeof row.versionNumber !== "number"
          ) {
            return null;
          }
          return {
            id: row.id,
            versionNumber: row.versionNumber,
            label: typeof row.label === "string" ? row.label : null,
            createdAt:
              typeof row.createdAt === "string" ? row.createdAt : undefined,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null)
    : undefined;
  return {
    id: o.id,
    name: o.name,
    meta: o.meta,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : undefined,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : undefined,
    versions,
  };
}

export async function listServerWorkflows(): Promise<WorkflowRow[]> {
  const body = await request<unknown>("/workflows", { method: "GET" });
  if (!Array.isArray(body)) {
    throw new Error(
      "Workflow API did not return a workflow list. Check VITE_WFENGINE_API.",
    );
  }
  return body.map(parseWorkflowRow).filter((v): v is WorkflowRow => v !== null);
}

export async function createServerWorkflow(name: string, meta?: unknown): Promise<WorkflowRow> {
  return await request<WorkflowRow>("/workflows", {
    method: "POST",
    body: JSON.stringify({ name, ...(meta !== undefined ? { meta } : {}) }),
  });
}

export async function getServerWorkflow(id: string): Promise<WorkflowRow> {
  return await request<WorkflowRow>(`/workflows/${encodeURIComponent(id)}`, { method: "GET" });
}

export async function createServerWorkflowVersion(
  workflowId: string,
  definition: unknown,
  label?: string,
): Promise<WorkflowVersionRow> {
  return await request<WorkflowVersionRow>(`/workflows/${encodeURIComponent(workflowId)}/versions`, {
    method: "POST",
    body: JSON.stringify({ definition, ...(label ? { label } : {}) }),
  });
}

export async function getServerWorkflowVersion(versionId: string): Promise<WorkflowVersionRow> {
  return await request<WorkflowVersionRow>(
    `/workflow-versions/${encodeURIComponent(versionId)}`,
    { method: "GET" },
  );
}

// ─── Async Execution API ─────────────────────────────────────────────────────

export type AsyncRunResponse = {
  executionId: string;
  status: "queued";
  createdAt: string;
};

export type ExecutionStatusResponse = {
  executionId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progressPercent?: number;
  currentNodeId?: string;
  currentAgentName?: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  workflowId?: string;
};

export type ExecutionEventData = {
  type: string;
  executionId: string;
  workflowId?: string;
  timestamp: string;
  // node events
  nodeId?: string;
  nodeType?: string;
  ok?: boolean;
  error?: string;
  durationMs?: number;
  // agent events
  agentName?: string;
  turn?: number;
  // tool events
  toolCallId?: string;
  toolName?: string;
  toolIndex?: number;
  // openai events
  model?: string;
  provider?: string;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  // completion events
  status?: string;
  completedAt?: string;
  failedAt?: string;
  startedAt?: string;
  // log events
  level?: string;
  message?: string;
  meta?: Record<string, unknown>;
};

/**
 * POST /runs — enqueue an async workflow execution.
 * Returns immediately with executionId.
 */
export async function startAsyncRun(body: {
  definition?: unknown;
  workflowVersionId?: string;
  initialData?: unknown;
  agentLibrary?: unknown;
  singleNodeRun?: { nodeId: string; seedOutputs: Record<string, unknown> };
}): Promise<AsyncRunResponse> {
  return await request<AsyncRunResponse>("/runs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * GET /runs/:executionId/status — lightweight polling endpoint.
 */
export async function getExecutionStatus(
  executionId: string,
): Promise<ExecutionStatusResponse> {
  return await request<ExecutionStatusResponse>(
    `/runs/${encodeURIComponent(executionId)}/status`,
    { method: "GET" },
  );
}

/**
 * GET /runs/:executionId/events — fetch all stored events (for replay).
 */
export async function getExecutionEvents(
  executionId: string,
): Promise<{ executionId: string; events: ExecutionEventData[] }> {
  return await request<{ executionId: string; events: ExecutionEventData[] }>(
    `/runs/${encodeURIComponent(executionId)}/events`,
    { method: "GET" },
  );
}

/**
 * DELETE /runs/:executionId — cancel a queued or running execution.
 */
export async function cancelExecution(
  executionId: string,
): Promise<{ executionId: string; status: string }> {
  return await request<{ executionId: string; status: string }>(
    `/runs/${encodeURIComponent(executionId)}`,
    { method: "DELETE" },
  );
}

/**
 * Subscribe to live execution events via SSE.
 * Returns a cleanup function — call it to close the connection.
 *
 * Falls back to polling if SSE is unavailable.
 */
export function subscribeToExecutionStream(
  executionId: string,
  onEvent: (event: ExecutionEventData) => void,
  onEnd: (status: "completed" | "failed" | "cancelled") => void,
  onError?: (err: Error) => void,
): () => void {
  const url = `${apiBase()}/runs/${encodeURIComponent(executionId)}/stream`;
  const headers = authHeaders();
  const apiKey = headers["x-api-key"];

  // EventSource doesn't support custom headers — use fetch + ReadableStream instead
  const ac = new AbortController();
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    ac.abort();
  };

  void (async () => {
    try {
      const res = await fetch(url, {
        headers: apiKey ? { "x-api-key": apiKey } : {},
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        onError?.(new Error(`SSE connection failed: ${res.status}`));
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });

        // SSE format: lines starting with "data: "
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue; // keepalive comment
          if (trimmed.startsWith("data: ")) {
            const json = trimmed.slice(6).trim();
            try {
              const event = JSON.parse(json) as ExecutionEventData;
              onEvent(event);

              if (event.type === "stream_end") {
                const s = event.status as "completed" | "failed" | "cancelled" | undefined;
                onEnd(s ?? "completed");
                cleanup();
                return;
              }
            } catch {
              /* malformed event — skip */
            }
          }
        }

        if (done) break;
      }
    } catch (err) {
      if (closed) return; // aborted intentionally
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return cleanup;
}

/**
 * Poll execution status until terminal state.
 * Used as fallback when SSE is unavailable.
 */
export function pollExecutionStatus(
  executionId: string,
  onStatus: (status: ExecutionStatusResponse) => void,
  onEnd: (status: "completed" | "failed" | "cancelled") => void,
  intervalMs = 1500,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const poll = async () => {
    if (stopped) return;
    try {
      const status = await getExecutionStatus(executionId);
      onStatus(status);
      if (
        status.status === "completed" ||
        status.status === "failed" ||
        status.status === "cancelled"
      ) {
        onEnd(status.status);
        return;
      }
    } catch {
      /* network error — keep polling */
    }
    if (!stopped) {
      timer = setTimeout(() => void poll(), intervalMs);
    }
  };

  void poll();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

