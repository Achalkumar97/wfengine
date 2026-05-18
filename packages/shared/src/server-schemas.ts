import { z } from "zod";
import { WorkflowDefinitionSchema } from "./workflow.schema.js";

/** Payload for persisting a new workflow version */
export const CreateWorkflowVersionBodySchema = z.object({
  definition: WorkflowDefinitionSchema,
  /** Optional label e.g. "draft", "live" */
  label: z.string().optional(),
});

export type CreateWorkflowVersionBody = z.infer<
  typeof CreateWorkflowVersionBodySchema
>;

/** Start execution (sync or async) */
export const StartExecutionBodySchema = z.object({
  workflowVersionId: z.string().uuid(),
  initialData: z.unknown().optional(),
  /** If true, queue job and return execution id without waiting */
  async: z.boolean().optional(),
});

export type StartExecutionBody = z.infer<typeof StartExecutionBodySchema>;

/** Run one node using cached outputs from prior execution (must include every direct parent). */
export const SingleNodeRunSchema = z.object({
  nodeId: z.string().min(1),
  seedOutputs: z.record(z.string(), z.unknown()),
});

export type SingleNodeRun = z.infer<typeof SingleNodeRunSchema>;

/** Optional Agent Library document sent from Studio so `library_agent` tools resolve on the server. */
export const AgentLibraryDocumentInlineSchema = z.object({
  schemaVersion: z.literal(1),
  agents: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1),
      systemPrompt: z.string().min(1),
      model: z.string().min(1).optional(),
    }),
  ),
});

export type AgentLibraryDocumentInline = z.infer<
  typeof AgentLibraryDocumentInlineSchema
>;

/** Execute a workflow definition in-process without persisting a version (Studio / dev runs). */
export const RunInlineDefinitionBodySchema = z.object({
  definition: WorkflowDefinitionSchema,
  initialData: z.unknown().optional(),
  /** When set, only `singleNodeRun.nodeId` executes; upstream data comes from `seedOutputs`. */
  singleNodeRun: SingleNodeRunSchema.optional(),
  /** Resolves `library_agent` tool references during agent node execution */
  agentLibrary: AgentLibraryDocumentInlineSchema.optional(),
});

export type RunInlineDefinitionBody = z.infer<
  typeof RunInlineDefinitionBodySchema
>;
