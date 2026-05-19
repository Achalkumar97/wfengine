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

function apiBase(): string {
  const raw = firstNonEmpty(
    runtimeConfig().VITE_WFENGINE_API,
    import.meta.env.VITE_WFENGINE_API,
  );
  return raw.replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
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
