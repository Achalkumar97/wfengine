import type { NodeDefinition } from "@wfengine/core";
import { directDownstreamToolOnlyNodeIds } from "@wfengine/shared";
import { validateRequiredFields } from "@wfengine/nodes-base/utils/validation.js";
import {
  AutogenMultiAgentConfigSchema,
  AutogenMultiAgentOutputSchema,
} from "../schemas.js";
import { formatAgentOrchestrationFailure } from "../runtime/agent-failure.js";
import { inferDefaultMultiAgentToolBinding } from "../runtime/multi-agent-tool-binding.js";
import { runOrchestratedOpenAiMultiAgent } from "../runtime/autogen-orchestrator.js";
import { runPythonAutogenBridge } from "../runtime/python-autogen-bridge.js";
import { resolveAgentPersonas } from "../runtime/resolve-agent-library.js";
import { applyDefaultRunDateIfNeeded } from "../runtime/upstream-payload.js";

export const autogenMultiAgentNode: NodeDefinition = {
  type: "autogen.multi-agent",
  label: "AutoGen: Multi-agent",
  category: "action",
  description:
    "Multiple agents with round-robin turns (or Python AutoGen bridge). Downstream receives transcript + finalAnswer.",
  configSchema:
    AutogenMultiAgentConfigSchema as unknown as import("zod").ZodType<
      Record<string, unknown>
    >,
  outputSchema:
    AutogenMultiAgentOutputSchema as unknown as import("zod").ZodType<
      Record<string, unknown>
    >,
  execute: async ({
    config,
    inputData,
    context,
    agentToolDispatch,
    workflow,
    nodeId,
  }) => {
    const c = AutogenMultiAgentConfigSchema.parse(config);
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
      const teamLabel = c.teamName?.trim() || "Multi-agent team";
      const check = validateRequiredFields(upstream, req, {
        error: `Missing workflow input (${teamLabel})`,
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
        AutogenMultiAgentOutputSchema.parse(fail);
        return fail;
      }
    }

    if (c.runtime === "python_autogen") {
      if (c.tools?.length) {
        context.logger.warn(
          "autogen.multi-agent: tools are ignored when runtime is python_autogen",
          { toolCount: c.tools.length },
        );
      }
      let bridge: Awaited<ReturnType<typeof runPythonAutogenBridge>>;
      try {
        bridge = await runPythonAutogenBridge({
          pythonExecutable: c.pythonExecutable ?? "python3",
          modulePath: c.pythonModulePath ?? "",
          payload: {
            mode: "multi" as const,
            teamName: c.teamName,
            agents,
            maxTurns: c.maxTurns,
            upstream,
            taskInstructions: c.taskInstructions,
          },
          timeoutMs: c.timeoutMs ?? 240_000,
        });
      } catch (rawErr) {
        const underlyingMessage =
          rawErr instanceof Error ? rawErr.message : String(rawErr);
        const underlyingStack =
          rawErr instanceof Error ? rawErr.stack : undefined;
        context.logger.error("autogen.multi-agent: python_autogen bridge failed", {
          message: underlyingMessage,
        });
        throw formatAgentOrchestrationFailure({
          nodeType: "autogen.multi-agent",
          phase: "python_autogen_bridge",
          underlyingMessage,
          underlyingStack,
        });
      }
      const tr = Array.isArray(bridge.transcript) ? bridge.transcript : [];
      const out = {
        success: bridge.success !== false,
        runtime: "python_autogen",
        teamName: c.teamName,
        model: c.model ?? "gpt-4o-mini",
        transcript: tr,
        finalAnswer: bridge.finalAnswer ?? "",
        notes: bridge.error,
      };
      AutogenMultiAgentOutputSchema.parse(out);
      return out;
    }

    const vars = context.variables as Record<string, unknown>;
    vars.__wfengineWorkflowNodeInvocationCount = 0;

    const maxTurns = c.maxTurns ?? 8;
    const resolvedToolBinding =
      c.multiAgentToolBinding ??
      inferDefaultMultiAgentToolBinding({
        tools: c.tools,
        maxTurns,
        agentsCount: agents.length,
        workflow,
      });
    context.logger.info("autogen.multi-agent: tool binding", {
      resolved: resolvedToolBinding,
      configExplicit: c.multiAgentToolBinding ?? null,
      maxTurns,
      agentsCount: agents.length,
    });

    const wfRefs = (c.tools ?? []).filter((t) => t.kind === "workflow_node");
    const targetsToolOnlyGraphNode = wfRefs.some((ref) => {
      const n = workflow.nodes.find((x) => x.id === ref.nodeId);
      const cfg = (n?.config ?? {}) as Record<string, unknown>;
      return cfg.wfengineToolOnly === true;
    });
    if (targetsToolOnlyGraphNode && maxTurns !== agents.length) {
      context.logger.warn(
        "autogen.multi-agent: shared tools point at wfengineToolOnly nodes but maxTurns !== number of agents — pipeline binding will NOT auto-apply; use Max turns = team size, set Tool binding to Pipeline, or set Force tools on turns (executor turn index)",
        { maxTurns, agentsCount: agents.length },
      );
    }

    const toolOnlyDownstream = directDownstreamToolOnlyNodeIds(workflow, nodeId);
    const hasWorkflowNodeTools = (c.tools ?? []).some(
      (t) => t.kind === "workflow_node",
    );
    if (toolOnlyDownstream.length > 0 && !hasWorkflowNodeTools) {
      throw formatAgentOrchestrationFailure({
        nodeType: "autogen.multi-agent",
        phase: "workflow_tools",
        underlyingMessage: `This team has a downstream path (possibly indirect) to tool-only nodes (${toolOnlyDownstream.join(", ")}), but this node has no \`workflow_node\` entries under Shared tools. The runtime would use plain chat (no tool_calls) and those file/email nodes would stay skipped. Fix: in Studio open the team → Shared tools → add workflow_node tools whose nodeIds match those canvas nodes, or re-import examples/workflows/weather-10d-mfa-team.json.`,
      });
    }

    const { transcript, finalAnswer } = await runOrchestratedOpenAiMultiAgent({
      teamName: c.teamName,
      agents,
      model: c.model ?? "gpt-4o-mini",
      temperature: c.temperature ?? 0.3,
      timeoutMs: c.timeoutMs ?? 240_000,
      taskInstructions: c.taskInstructions,
      openAi: {
        llmProvider: c.llmProvider,
        llmProviderWasExplicit: Object.prototype.hasOwnProperty.call(
          config,
          "llmProvider",
        ),
        openAiBaseUrl: c.openAiBaseUrl,
        openAiApiKey: c.openAiApiKey,
        ollamaBaseUrl: c.ollamaBaseUrl,
      },
      upstream,
      logger: context.logger,
      maxTurns,
      tools: c.tools,
      agentToolDispatch,
      variables: context.variables,
      forceToolsFirstCompletionOnTurnIndices:
        c.forceToolsFirstCompletionOnTurnIndices,
      multiAgentToolBinding: resolvedToolBinding,
      executionContext: {
        executionId: context.executionId,
        workflowId: context.workflowId,
        nodeId,
      },
      signal: context.signal,
    });

    const wfNodeTools = (c.tools ?? []).filter((t) => t.kind === "workflow_node");
    if (wfNodeTools.length > 0) {
      const invRaw = vars.__wfengineWorkflowNodeInvocationCount;
      const inv =
        typeof invRaw === "number" && Number.isFinite(invRaw) ? invRaw : 0;
      if (inv < 1) {
        throw formatAgentOrchestrationFailure({
          nodeType: "autogen.multi-agent",
          phase: "workflow_tools",
          underlyingMessage: `This team has ${wfNodeTools.length} workflow_node tool(s) configured (${wfNodeTools.map((x) => x.nodeId).join(", ")}), but the model did not call any of them, so file/email steps never ran. Set Initial data (e.g. runDate), keep tool \`nodeId\`s equal to the canvas, and make the last agent turn call each tool. If the model only outputs text, try a more tool-faithful model or lower temperature.`,
        });
      }
    }

    const out = {
      success: true,
      runtime: "orchestrated_openai",
      teamName: c.teamName,
      model: c.model ?? "gpt-4o-mini",
      transcript,
      finalAnswer,
    };
    AutogenMultiAgentOutputSchema.parse(out);
    return out;
  },
};
