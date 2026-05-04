import type { NodeDefinition } from "@wfengine/core";
import { validateRequiredFields } from "@wfengine/nodes-base/utils/validation.js";
import {
  MfaAgentGroupConfigSchema,
  MfaAgentGroupOutputSchema,
} from "../schemas.js";
import { runMfaAgentGroupOrchestration } from "../runtime/mfa-orchestrator.js";
import { resolveAgentPersonas } from "../runtime/resolve-agent-library.js";
import { applyDefaultRunDateIfNeeded } from "../runtime/upstream-payload.js";

export const mfaAgentGroupNode: NodeDefinition = {
  type: "mfa.agent-group",
  label: "MAF: Agent group",
  category: "action",
  description:
    "Runs multiple collaborating agents over merged upstream JSON using OpenAI-compatible chat (Microsoft Agent Framework–style orchestration). Set OPENAI_API_KEY on the runner or openAiApiKey in config.",
  configSchema:
    MfaAgentGroupConfigSchema as unknown as import("zod").ZodType<
      Record<string, unknown>
    >,
  outputSchema:
    MfaAgentGroupOutputSchema as unknown as import("zod").ZodType<
      Record<string, unknown>
    >,
  execute: async ({ config, inputData, context }) => {
    const c = MfaAgentGroupConfigSchema.parse(config);
    const upstream: Record<string, unknown> = {
      ...(inputData as Record<string, unknown>),
    };
    const agents = resolveAgentPersonas(
      c.agents,
      context.variables as Record<string, unknown> | undefined,
    );

    const req = c.requiredUpstreamFields;
    applyDefaultRunDateIfNeeded(upstream, req, context.logger);

    if (req?.length) {
      const groupLabel = c.groupName?.trim() || "Agent group";
      const check = validateRequiredFields(upstream, req, {
        error: `Missing workflow input (${groupLabel})`,
        buildMessage: (missing) => {
          const fields = missing.join(", ");
          return `Set these fields in Initial data (JSON) on the Run panel: ${fields}. Example: { "runDate": "2026-05-04", "budgetInr": 25000, "region": "IN" }.`;
        },
      });
      if (!check.success) {
        const fail = {
          success: false as const,
          error: check.error,
          missingFields: check.missingFields,
          message: check.message,
        };
        MfaAgentGroupOutputSchema.parse(fail);
        return fail;
      }
    }

    const { transcript, finalAnswer, structured } =
      await runMfaAgentGroupOrchestration({
        config: { ...c, agents },
        upstream,
        logger: context.logger,
      });

    const out = {
      success: true,
      groupName: c.groupName,
      orchestrationMode: c.orchestrationMode ?? "sequential",
      model: c.model ?? "gpt-4o-mini",
      transcript,
      finalAnswer,
      ...(structured ? { structured } : {}),
    };
    MfaAgentGroupOutputSchema.parse(out);
    return out;
  },
};
