import type { z } from "zod";
import { AutogenAgentConfigSchema } from "../schemas.js";

/** Persona after optional `libraryAgentId` merge from `variables.agentLibrary`. */
export type ResolvedAgentPersona = {
  name: string;
  role?: string | undefined;
  systemPrompt: string;
};

type LibraryRow = {
  name: string;
  systemPrompt: string;
  model?: string | undefined;
};

export function buildAgentLibraryMap(
  variables: Record<string, unknown> | undefined,
): Map<string, LibraryRow> {
  const out = new Map<string, LibraryRow>();
  const raw = variables?.agentLibrary;
  if (!raw || typeof raw !== "object") return out;
  const agents = (raw as { agents?: unknown }).agents;
  if (!Array.isArray(agents)) return out;
  for (const a of agents) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const id = o.id;
    const name = o.name;
    const systemPrompt = o.systemPrompt;
    if (
      typeof id === "string" &&
      typeof name === "string" &&
      typeof systemPrompt === "string"
    ) {
      const model = o.model;
      out.set(id, {
        name,
        systemPrompt,
        model: typeof model === "string" ? model : undefined,
      });
    }
  }
  return out;
}

/**
 * Merge `libraryAgentId` rows from `variables.agentLibrary` into each persona.
 * Inline `systemPrompt` / `name` override library defaults when non-empty after trim.
 */
export function resolveAgentPersonas(
  personas: ReadonlyArray<{
    name: string;
    systemPrompt?: string | undefined;
    role?: string | undefined;
    libraryAgentId?: string | undefined;
  }>,
  variables: Record<string, unknown> | undefined,
): ResolvedAgentPersona[] {
  const map = buildAgentLibraryMap(variables);
  return personas.map((p, i) => {
    if (!p.libraryAgentId) {
      const sp = p.systemPrompt;
      if (sp === undefined || sp.length < 1) {
        throw new Error(
          `Agent #${i + 1} "${p.name}": systemPrompt is required when libraryAgentId is not set`,
        );
      }
      return { name: p.name, role: p.role, systemPrompt: sp };
    }
    const entry = map.get(p.libraryAgentId);
    if (!entry) {
      throw new Error(
        `Agent "${p.name}" references library id ${p.libraryAgentId} but it was not found in variables.agentLibrary.agents. Include agentLibrary in the run request (Studio passes it when the library is non-empty).`,
      );
    }
    const systemPrompt =
      p.systemPrompt !== undefined && p.systemPrompt.trim().length > 0
        ? p.systemPrompt
        : entry.systemPrompt;
    return { name: p.name, role: p.role, systemPrompt };
  });
}

type AutogenConfig = z.infer<typeof AutogenAgentConfigSchema>;

/**
 * Fills `systemPrompt` and default `agentName` from the Agent Library when `libraryAgentId` is set.
 */
export function mergeAutogenAgentConfigWithLibrary(
  c: AutogenConfig,
  variables: Record<string, unknown> | undefined,
): AutogenConfig {
  if (!c.libraryAgentId) return c;
  const map = buildAgentLibraryMap(variables);
  const entry = map.get(c.libraryAgentId);
  if (!entry) {
    throw new Error(
      `autogen.agent: libraryAgentId ${c.libraryAgentId} not found in variables.agentLibrary. Include agentLibrary in the run request when using a library binding.`,
    );
  }
  const systemPrompt =
    c.systemPrompt !== undefined && c.systemPrompt.trim().length > 0
      ? c.systemPrompt
      : entry.systemPrompt;
  const agentName =
    c.agentName !== undefined &&
    c.agentName.trim().length > 0 &&
    c.agentName !== "agent"
      ? c.agentName
      : entry.name;
  return { ...c, systemPrompt, agentName };
}
