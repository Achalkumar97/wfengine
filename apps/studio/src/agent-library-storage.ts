import {
  AgentLibraryDocumentSchema,
  type AgentLibraryDocument,
  type AgentLibraryEntry,
} from "@wfengine/nodes-agents/schemas";
import { DEFAULT_AGENT_LIBRARY_DOCUMENT } from "./default-agent-library.js";

const KEY = "wfengine.studio.agentLibrary.v1";

function emptyDoc(): AgentLibraryDocument {
  return { schemaVersion: 1, agents: [] };
}

/** First visit: seed curated agents so the library is immediately usable. */
function seedIfMissing(): AgentLibraryDocument {
  if (typeof localStorage === "undefined") return DEFAULT_AGENT_LIBRARY_DOCUMENT;
  const r = AgentLibraryDocumentSchema.safeParse(DEFAULT_AGENT_LIBRARY_DOCUMENT);
  if (!r.success) return emptyDoc();
  localStorage.setItem(KEY, JSON.stringify(r.data));
  return r.data;
}

export function loadAgentLibrary(): AgentLibraryDocument {
  if (typeof localStorage === "undefined") return emptyDoc();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedIfMissing();
    const parsed = JSON.parse(raw) as unknown;
    const r = AgentLibraryDocumentSchema.safeParse(parsed);
    return r.success ? r.data : emptyDoc();
  } catch {
    return emptyDoc();
  }
}

export function saveAgentLibrary(doc: AgentLibraryDocument): void {
  if (typeof localStorage === "undefined") return;
  const r = AgentLibraryDocumentSchema.safeParse(doc);
  if (!r.success) return;
  localStorage.setItem(KEY, JSON.stringify(r.data));
}

export function createAgentEntry(
  partial: Omit<AgentLibraryEntry, "id"> & { id?: string },
): AgentLibraryEntry {
  const id =
    partial.id ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `agent-${Math.random().toString(36).slice(2, 12)}`);
  return {
    id,
    name: partial.name,
    systemPrompt: partial.systemPrompt,
    model: partial.model ?? "gpt-4o-mini",
    defaultTools: partial.defaultTools,
    provider: partial.provider,
  };
}
