import { z } from "zod";

/**
 * Reference from an AI agent config to a callable "tool".
 * - **workflow_node**: another node in the *same* graph, invoked by id (subgraph / tool runner — see architecture doc).
 * - **library_agent**: an entry from the Agent Library (reusable persona / sub-agent).
 */
export const AgentToolRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("workflow_node"),
    /** Canvas node id (must exist in the same workflow definition at run time) */
    nodeId: z.string().min(1).max(200),
    /** Shown in LLM tool list; defaults to node id in the executor if omitted */
    displayName: z.string().max(200).optional(),
    /** Short description for the model (optional) */
    description: z.string().max(2_000).optional(),
  }),
  z.object({
    kind: z.literal("library_agent"),
    /** Matches `AgentLibraryEntrySchema.id` */
    agentId: z.string().uuid(),
    displayName: z.string().max(200).optional(),
    description: z.string().max(2_000).optional(),
  }),
]);

export type AgentToolRef = z.infer<typeof AgentToolRefSchema>;

/**
 * Reusable agent definition for Studio **Agent Library** (stored separately from workflow JSON).
 * Versioned file shape for import/export of the library tab.
 */
export const AgentLibraryEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  systemPrompt: z.string().min(1).max(32_000),
  model: z.string().min(1).max(120).default("gpt-4o-mini"),
  /** Default tool refs when this agent is dragged onto the canvas */
  defaultTools: z.array(AgentToolRefSchema).max(32).optional(),
  /** Optional provider hint for Studio / future routers — executor still uses env + model string today */
  provider: z.enum(["openai", "anthropic", "azure_openai", "other"]).optional(),
});

export type AgentLibraryEntry = z.infer<typeof AgentLibraryEntrySchema>;

/** Persisted Agent Library document (e.g. `agent-library.json` or Studio localStorage) */
export const AgentLibraryDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  agents: z.array(AgentLibraryEntrySchema),
});

export type AgentLibraryDocument = z.infer<typeof AgentLibraryDocumentSchema>;

/** When multi-agent team should stop (executor interprets; Phase 2+). */
export const MultiAgentStopModeSchema = z.enum([
  /** Stop after `maxTurns` round-robin steps (current behavior) */
  "max_turns",
  /** Reserved: stop when coordinator emits a termination signal (future) */
  "termination_token",
]);

export type MultiAgentStopMode = z.infer<typeof MultiAgentStopModeSchema>;
