function apiBase(): string {
  const raw = import.meta.env.VITE_WFENGINE_API ?? "";
  return raw.replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const key = import.meta.env.VITE_WFENGINE_API_KEY;
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
    throw new Error(errorMessageFromBody(res.status, body));
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

export async function listServerWorkflows(): Promise<WorkflowRow[]> {
  return await request<WorkflowRow[]>("/workflows", { method: "GET" });
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

