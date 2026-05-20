import { UpstreamValidationFailedSchema } from "@wfengine/nodes-base/utils/validation.js";
import { z } from "zod";
import {
  AgentToolRefSchema,
  MultiAgentStopModeSchema,
} from "./agent-tools.schema.js";

/** One agent in a group (MFA / AutoGen multi). */
export const AgentPersonaSchema = z
  .object({
    name: z.string().min(1).max(120),
    /** Required unless `libraryAgentId` is set (prompt loaded from `variables.agentLibrary` at run time). */
    systemPrompt: z.string().max(32_000).optional(),
    /** Optional short label for transcripts */
    role: z.string().max(120).optional(),
    /** When set, missing `systemPrompt` is merged from the Agent Library document on the run. */
    libraryAgentId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.libraryAgentId) return;
    if (data.systemPrompt === undefined || data.systemPrompt.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["systemPrompt"],
        message: "Required when libraryAgentId is not set",
      });
    }
  });

export type AgentPersona = z.infer<typeof AgentPersonaSchema>;

const LlmProviderSchema = z.enum(["openai", "ollama"]).optional().default("openai");
const LlmBaseUrlSchema = z.union([z.string().url(), z.literal("")]).optional();

/** Microsoft Agent Framework–style group: orchestrated LLM agents sharing workflow context. */
export const MfaAgentGroupConfigSchema = z.object({
  /** Human-readable label in logs */
  groupName: z.string().max(200).optional(),
  /**
   * How contributions are combined logically (future backends may interpret differently).
   * - sequential: each agent sees prior assistant outputs in-thread.
   * - single_completion: one model call returns JSON with full transcript (fast).
   */
  orchestrationMode: z
    .enum(["sequential", "single_completion"])
    .optional()
    .default("sequential"),
  agents: z.array(AgentPersonaSchema).min(1).max(16),
  model: z.string().min(1).optional().default("gpt-4o-mini"),
  /** Selects the OpenAI-compatible provider for this node. */
  llmProvider: LlmProviderSchema,
  openAiBaseUrl: LlmBaseUrlSchema,
  openAiApiKey: z.string().optional().describe("secret:openai_api_key"),
  /** OpenAI-compatible Ollama base URL, usually http://127.0.0.1:11434/v1. */
  ollamaBaseUrl: LlmBaseUrlSchema,
  temperature: z.coerce.number().min(0).max(2).optional().default(0.3),
  /** Wall-clock cap for the whole node */
  timeoutMs: z.coerce.number().int().min(5_000).max(900_000).optional().default(180_000),
  /** Extra instructions appended after upstream JSON */
  taskInstructions: z.string().max(16_000).optional(),
  /**
   * If set, the node returns a structured validation error when any listed key
   * is missing or empty on the merged upstream `inputData` (flat keys only).
   */
  requiredUpstreamFields: z.array(z.string().min(1)).max(64).optional(),
});

export const MfaAgentTranscriptEntrySchema = z.object({
  agent: z.string(),
  content: z.string(),
});

const MfaAgentGroupSuccessOutputSchema = z.object({
  success: z.boolean(),
  groupName: z.string().optional(),
  orchestrationMode: z.string(),
  model: z.string(),
  transcript: z.array(MfaAgentTranscriptEntrySchema),
  /** Last agent reply or synthesized summary */
  finalAnswer: z.string(),
  /** Parsed JSON when orchestrationMode is single_completion */
  structured: z.record(z.unknown()).optional(),
});

export const MfaAgentGroupOutputSchema = z.union([
  UpstreamValidationFailedSchema,
  MfaAgentGroupSuccessOutputSchema,
]);

/** Shape before `superRefine` — use `.partial()` for Studio form defaults. */
export const AutogenAgentConfigBaseSchema = z.object({
  agentName: z.string().min(1).max(120).optional().default("agent"),
  /** Required unless `libraryAgentId` is set (merged from `variables.agentLibrary` at run time). */
  systemPrompt: z.string().max(32_000).optional(),
  model: z.string().min(1).optional().default("gpt-4o-mini"),
  /** Selects the OpenAI-compatible provider for this node. */
  llmProvider: LlmProviderSchema,
  openAiBaseUrl: LlmBaseUrlSchema,
  openAiApiKey: z.string().optional().describe("secret:openai_api_key"),
  /** OpenAI-compatible Ollama base URL, usually http://127.0.0.1:11434/v1. */
  ollamaBaseUrl: LlmBaseUrlSchema,
  temperature: z.coerce.number().min(0).max(2).optional().default(0.3),
  timeoutMs: z.coerce.number().int().min(5_000).max(900_000).optional().default(120_000),
  /**
   * openai_compatible: chat completion in-process (default).
   * python_autogen: spawn Python with AutoGen (requires script + deps on runner).
   */
  runtime: z.enum(["openai_compatible", "python_autogen"]).optional().default("openai_compatible"),
  pythonExecutable: z.string().optional(),
  /** Module path passed to Python bridge (see README) */
  pythonModulePath: z.string().optional(),
  /**
   * Workflow nodes / library agents callable as tools when the executor supports tool loops (Phase 2).
   * Omitted = legacy chat-only behavior (current default runtime path).
   */
  tools: z.array(AgentToolRefSchema).max(32).optional(),
  /** Bind this node instance to a reusable Agent Library entry (Studio); merges with inline prompt/model when present */
  libraryAgentId: z.string().uuid().optional(),
  /**
   * If set, the node returns a structured validation error when any listed key
   * is missing or empty on the merged upstream `inputData` (flat keys only).
   */
  requiredUpstreamFields: z.array(z.string().min(1)).max(64).optional(),
});

/** Single AutoGen-style agent (Node runtime uses OpenAI-compatible or Python bridge). */
export const AutogenAgentConfigSchema = AutogenAgentConfigBaseSchema.superRefine(
  (data, ctx) => {
    if (data.libraryAgentId) return;
    if (data.systemPrompt === undefined || data.systemPrompt.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["systemPrompt"],
        message: "Required when libraryAgentId is not set",
      });
    }
  },
);

/** For react-hook-form / partial configs — full schema is `ZodEffects` and has no `.partial()`. */
export const AutogenAgentConfigPartialSchema = AutogenAgentConfigBaseSchema.partial();

const AutogenAgentSuccessOutputSchema = z.object({
  success: z.boolean(),
  runtime: z.string(),
  agentName: z.string(),
  model: z.string(),
  output: z.string(),
  raw: z.record(z.unknown()).optional(),
});

export const AutogenAgentOutputSchema = z.union([
  UpstreamValidationFailedSchema,
  AutogenAgentSuccessOutputSchema,
]);

/** Multiple AutoGen agents with optional Python AutoGen team execution. */
export const AutogenMultiAgentConfigSchema = z.object({
  teamName: z.string().max(200).optional(),
  agents: z.array(AgentPersonaSchema).min(2).max(16),
  maxTurns: z.coerce.number().int().min(1).max(40).optional().default(8),
  model: z.string().min(1).optional().default("gpt-4o-mini"),
  /** Selects the OpenAI-compatible provider for this node. */
  llmProvider: LlmProviderSchema,
  openAiBaseUrl: LlmBaseUrlSchema,
  openAiApiKey: z.string().optional().describe("secret:openai_api_key"),
  /** OpenAI-compatible Ollama base URL, usually http://127.0.0.1:11434/v1. */
  ollamaBaseUrl: LlmBaseUrlSchema,
  temperature: z.coerce.number().min(0).max(2).optional().default(0.3),
  timeoutMs: z.coerce.number().int().min(5_000).max(900_000).optional().default(240_000),
  /**
   * orchestrated_openai: round-robin chat turns in Node (no Python).
   * python_autogen: delegate to Python process if configured.
   */
  runtime: z
    .enum(["orchestrated_openai", "python_autogen"])
    .optional()
    .default("orchestrated_openai"),
  pythonExecutable: z.string().optional(),
  pythonModulePath: z.string().optional(),
  taskInstructions: z.string().max(16_000).optional(),
  /** Shared tools for the whole team (same semantics as `autogen.agent.tools`) */
  tools: z.array(AgentToolRefSchema).max(32).optional(),
  /**
   * How OpenAI **tool_choice** is applied relative to graph nodes (`workflow_node` tools).
   *
   * - **openai_tools_auto** — API default: the model may answer with plain text and never call tools (common cause of
   *   “skipped” tool-only nodes if the LLM ignores tools).
   * - **pipeline_last_turn_tools_required** — when `maxTurns === agents.length` (each persona once), the **last**
   *   turn’s first completion uses `tool_choice: required` so the model must issue at least one tool call before
   *   finishing that turn (typical analyst → … → executor pattern). No magic turn index needed.
   */
  multiAgentToolBinding: z
    .enum(["openai_tools_auto", "pipeline_last_turn_tools_required"])
    .optional(),
  /**
   * Advanced: explicit 0-based turn indices where the first completion uses `tool_choice: required`.
   * Overrides / adds to {@link multiAgentToolBinding} for non-standard turn counts.
   */
  forceToolsFirstCompletionOnTurnIndices: z
    .array(z.coerce.number().int().min(0).max(39))
    .max(16)
    .optional(),
  /** How/when orchestration stops — `max_turns` matches current Node round-robin cap */
  stopMode: MultiAgentStopModeSchema.optional().default("max_turns"),
  /**
   * If set, the node returns a structured validation error when any listed key
   * is missing or empty on the merged upstream `inputData` (flat keys only).
   */
  requiredUpstreamFields: z.array(z.string().min(1)).max(64).optional(),
});

const AutogenMultiAgentSuccessOutputSchema = z.object({
  success: z.boolean(),
  runtime: z.string(),
  teamName: z.string().optional(),
  model: z.string(),
  transcript: z.array(MfaAgentTranscriptEntrySchema),
  finalAnswer: z.string(),
  notes: z.string().optional(),
});

export const AutogenMultiAgentOutputSchema = z.union([
  UpstreamValidationFailedSchema,
  AutogenMultiAgentSuccessOutputSchema,
]);

/**
 * Structured state schema for multi-agent workflows.
 * Agents should output JSON matching this schema instead of free text.
 * This enables reliable state passing between agents and validation.
 */
export const ProductCandidateSchema = z.object({
  name: z.string().min(1),
  price: z.string().optional(),
  features: z.array(z.string()).optional(),
  source: z.string().optional(),
  evidence: z.string().optional(),
});

export const ComparisonResultSchema = z.object({
  topPick: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
});

export const EmailContentSchema = z.object({
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().optional(),
  to: z.union([z.string().min(1), z.array(z.string().min(1))]),
});

export const SlackContentSchema = z.object({
  text: z.string().min(1),
  channel: z.string().optional(),
});

export const ProductComparisonStateSchema = z.object({
  product: z.string().optional(),
  budgetInr: z.coerce.number().optional(),
  candidates: z.array(ProductCandidateSchema).optional(),
  comparison: ComparisonResultSchema.optional(),
  email: EmailContentSchema.optional(),
  slack: SlackContentSchema.optional(),
});

/** Browser-safe re-exports (avoid `@wfengine/nodes-agents` barrel → node runtime). */
export {
  AgentToolRefSchema,
  AgentLibraryEntrySchema,
  AgentLibraryDocumentSchema,
  MultiAgentStopModeSchema,
  type AgentToolRef,
  type AgentLibraryEntry,
  type AgentLibraryDocument,
  type MultiAgentStopMode,
} from "./agent-tools.schema.js";
