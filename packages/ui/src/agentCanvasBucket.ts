/** Minimal library row for model resolution (matches Studio `agentLibrary` entries). */
export type AgentLibraryEntryLite = {
  id: string;
  model?: string | undefined;
};

export type AgentBucketRow = {
  name: string;
  model: string;
  source: "library" | "inline";
};

const DEFAULT_MODEL = "gpt-4o-mini";

function teamModelFromConfig(
  config: Record<string, unknown> | undefined,
): string {
  if (!config) return DEFAULT_MODEL;
  const m = config.model;
  if (typeof m === "string" && m.trim().length > 0) return m.trim();
  return DEFAULT_MODEL;
}

function modelForPersona(
  libraryAgentId: string | undefined,
  teamModel: string,
  libraryEntries: readonly AgentLibraryEntryLite[] | undefined,
): string {
  if (!libraryAgentId || !libraryEntries?.length) return teamModel;
  const row = libraryEntries.find((e) => e.id === libraryAgentId);
  const lm = row?.model?.trim();
  return lm && lm.length > 0 ? lm : teamModel;
}

/** Workflow node types that show the canvas agent bucket. */
export function isAgentBucketNodeType(wfType: string): boolean {
  return (
    wfType === "mfa.agent-group" ||
    wfType === "autogen.multi-agent" ||
    wfType === "autogen.agent"
  );
}

/** Only team nodes can add agents from the canvas bucket (+ Add agent). */
export function supportsCanvasAgentAdd(wfType: string): boolean {
  return wfType === "mfa.agent-group" || wfType === "autogen.multi-agent";
}

/**
 * Derives compact preview rows for canvas rendering from persisted node config.
 */
export function deriveAgentBucketRows(
  wfType: string,
  config: Record<string, unknown>,
  libraryEntries: readonly AgentLibraryEntryLite[] | undefined,
): AgentBucketRow[] {
  const teamModel = teamModelFromConfig(config);

  if (wfType === "autogen.agent") {
    const agentName =
      typeof config.agentName === "string" && config.agentName.trim().length > 0
        ? config.agentName.trim()
        : "agent";
    const libId =
      typeof config.libraryAgentId === "string"
        ? config.libraryAgentId
        : undefined;
    const model = modelForPersona(libId, teamModel, libraryEntries);
    return [
      {
        name: agentName,
        model,
        source: libId ? "library" : "inline",
      },
    ];
  }

  if (wfType === "mfa.agent-group" || wfType === "autogen.multi-agent") {
    const agents = config.agents;
    if (!Array.isArray(agents)) return [];
    const rows: AgentBucketRow[] = [];
    for (const raw of agents) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const name =
        typeof o.name === "string" && o.name.trim().length > 0
          ? o.name.trim()
          : "?";
      const libId =
        typeof o.libraryAgentId === "string" ? o.libraryAgentId : undefined;
      const model = modelForPersona(libId, teamModel, libraryEntries);
      rows.push({
        name,
        model,
        source: libId ? "library" : "inline",
      });
    }
    return rows;
  }

  return [];
}
