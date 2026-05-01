import { z } from "zod";

/** Single edge: data flows source → target */
export const WorkflowEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
});

/** Node instance inside a workflow graph */
export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.unknown()).optional().default({}),
});

/** Full workflow graph (DAG) definition */
export const WorkflowDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive().optional(),
  nodes: z.array(WorkflowNodeSchema).min(1),
  edges: z.array(WorkflowEdgeSchema).default([]),
});

export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

/**
 * Parse and validate unknown JSON as a workflow definition.
 * @throws ZodError on invalid input
 */
export function parseWorkflow(input: unknown): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse(input);
}

export function safeParseWorkflow(input: unknown) {
  return WorkflowDefinitionSchema.safeParse(input);
}
