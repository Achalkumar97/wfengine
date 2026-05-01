import type { WfNodeData } from "@wfengine/ui";
import type { Edge, Node } from "reactflow";

/** localStorage key for full canvas + inspector state (includes node positions). */
export const STUDIO_SNAPSHOT_KEY = "wfengine.studio.snapshot.v1";

export type StudioSnapshotV1 = {
  v: 1;
  workflowId: string;
  workflowDescription: string;
  initialDataRaw: string;
  nodes: Node<WfNodeData>[];
  edges: Edge[];
  savedAt: string;
};

/** Index of multi-workflow local drafts (workspaces). */
export const STUDIO_WORKSPACES_INDEX_KEY = "wfengine.studio.workspaces.v1";
export const STUDIO_WORKSPACE_KEY_PREFIX = "wfengine.studio.workspace.";
const STUDIO_WORKSPACES_MIGRATED_KEY = "wfengine.studio.workspaces.migrated.v1";

export type StudioWorkspaceMetaV1 = {
  v: 1;
  id: string;
  title: string;
  workflowId: string;
  savedAt: string;
};

export type StudioWorkspaceV1 = StudioWorkspaceMetaV1 & {
  workflowDescription: string;
  initialDataRaw: string;
  nodes: Node<WfNodeData>[];
  edges: Edge[];
};

export function loadStudioSnapshot(): StudioSnapshotV1 | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STUDIO_SNAPSHOT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StudioSnapshotV1>;
    if (p.v !== 1 || !Array.isArray(p.nodes) || !Array.isArray(p.edges)) {
      return null;
    }
    return {
      v: 1,
      workflowId: typeof p.workflowId === "string" ? p.workflowId : "studio-draft",
      workflowDescription:
        typeof p.workflowDescription === "string" ? p.workflowDescription : "",
      initialDataRaw: typeof p.initialDataRaw === "string" ? p.initialDataRaw : "{}",
      nodes: p.nodes as Node<WfNodeData>[],
      edges: p.edges as Edge[],
      savedAt: typeof p.savedAt === "string" ? p.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveStudioSnapshot(payload: {
  workflowId: string;
  workflowDescription: string;
  initialDataRaw: string;
  nodes: Node<WfNodeData>[];
  edges: Edge[];
}): void {
  if (typeof localStorage === "undefined") return;
  const snap: StudioSnapshotV1 = {
    v: 1,
    workflowId: payload.workflowId,
    workflowDescription: payload.workflowDescription,
    initialDataRaw: payload.initialDataRaw,
    nodes: payload.nodes,
    edges: payload.edges,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(STUDIO_SNAPSHOT_KEY, JSON.stringify(snap));
}

function workspaceKey(id: string): string {
  return `${STUDIO_WORKSPACE_KEY_PREFIX}${id}.v1`;
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadWorkspacesIndex(): StudioWorkspaceMetaV1[] {
  if (typeof localStorage === "undefined") return [];
  const parsed = safeParseJson<unknown>(localStorage.getItem(STUDIO_WORKSPACES_INDEX_KEY));
  if (!Array.isArray(parsed)) return [];
  const metas = parsed as Partial<StudioWorkspaceMetaV1>[];
  const out: StudioWorkspaceMetaV1[] = [];
  for (const m of metas) {
    if (m.v !== 1) continue;
    if (typeof m.id !== "string") continue;
    out.push({
      v: 1,
      id: m.id,
      title: typeof m.title === "string" ? m.title : m.id,
      workflowId: typeof m.workflowId === "string" ? m.workflowId : "studio-draft",
      savedAt: typeof m.savedAt === "string" ? m.savedAt : new Date().toISOString(),
    });
  }
  // newest first
  out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return out;
}

function saveWorkspacesIndex(metas: StudioWorkspaceMetaV1[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STUDIO_WORKSPACES_INDEX_KEY, JSON.stringify(metas));
}

/**
 * One-time migration: if the old single snapshot exists and there is no
 * workspaces index yet, create a first workspace out of it.
 */
export function migrateSnapshotToWorkspacesIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(STUDIO_WORKSPACES_MIGRATED_KEY) === "1") return;
  const existingIndex = localStorage.getItem(STUDIO_WORKSPACES_INDEX_KEY);
  if (existingIndex) {
    localStorage.setItem(STUDIO_WORKSPACES_MIGRATED_KEY, "1");
    return;
  }
  const snap = loadStudioSnapshot();
  if (!snap) {
    localStorage.setItem(STUDIO_WORKSPACES_MIGRATED_KEY, "1");
    return;
  }
  const id = `ws-${snap.workflowId || "draft"}-${Date.now()}`;
  saveWorkspace(id, {
    title: snap.workflowId || "Imported snapshot",
    workflowId: snap.workflowId,
    workflowDescription: snap.workflowDescription,
    initialDataRaw: snap.initialDataRaw,
    nodes: snap.nodes,
    edges: snap.edges,
  });
  localStorage.setItem(STUDIO_WORKSPACES_MIGRATED_KEY, "1");
}

export function listWorkspaces(): StudioWorkspaceMetaV1[] {
  migrateSnapshotToWorkspacesIfNeeded();
  return loadWorkspacesIndex();
}

export function loadWorkspace(id: string): StudioWorkspaceV1 | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(workspaceKey(id));
  const parsed = safeParseJson<Partial<StudioWorkspaceV1>>(raw);
  if (!parsed || parsed.v !== 1) return null;
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
  return {
    v: 1,
    id,
    title: typeof parsed.title === "string" ? parsed.title : id,
    workflowId: typeof parsed.workflowId === "string" ? parsed.workflowId : "studio-draft",
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
    workflowDescription:
      typeof parsed.workflowDescription === "string" ? parsed.workflowDescription : "",
    initialDataRaw: typeof parsed.initialDataRaw === "string" ? parsed.initialDataRaw : "{}",
    nodes: parsed.nodes as Node<WfNodeData>[],
    edges: parsed.edges as Edge[],
  };
}

export function saveWorkspace(
  id: string,
  payload: Omit<StudioWorkspaceV1, "v" | "id" | "savedAt"> & { savedAt?: string },
): void {
  if (typeof localStorage === "undefined") return;
  const savedAt = payload.savedAt ?? new Date().toISOString();
  const ws: StudioWorkspaceV1 = {
    v: 1,
    id,
    title: payload.title,
    workflowId: payload.workflowId,
    savedAt,
    workflowDescription: payload.workflowDescription,
    initialDataRaw: payload.initialDataRaw,
    nodes: payload.nodes,
    edges: payload.edges,
  };
  localStorage.setItem(workspaceKey(id), JSON.stringify(ws));

  const metas = loadWorkspacesIndex();
  const meta: StudioWorkspaceMetaV1 = {
    v: 1,
    id,
    title: ws.title,
    workflowId: ws.workflowId,
    savedAt,
  };
  const next = [meta, ...metas.filter((m) => m.id !== id)];
  saveWorkspacesIndex(next);
}

export function deleteWorkspace(id: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(workspaceKey(id));
  const metas = loadWorkspacesIndex().filter((m) => m.id !== id);
  saveWorkspacesIndex(metas);
}
