import type { NodeDefinition } from "@wfengine/core";
import { validateRequiredFields } from "@wfengine/nodes-base/utils/validation.js";
import {
  AutogenAgentConfigSchema,
  AutogenAgentOutputSchema,
} from "../schemas.js";
import {
  openAiChatCompletion,
  resolveOpenAiFromEnv,
} from "../runtime/openai-chat.js";
import { runOpenAiToolLoop } from "../runtime/openai-tool-loop.js";
import { upstreamToJsonText } from "../runtime/upstream-payload.js";
import { formatAgentOrchestrationFailure } from "../runtime/agent-failure.js";
import { runPythonAutogenBridge } from "../runtime/python-autogen-bridge.js";
import { mergeAutogenAgentConfigWithLibrary } from "../runtime/resolve-agent-library.js";

export const autogenAgentNode: NodeDefinition = {
  type: "autogen.agent",
  label: "AutoGen: Single agent",
  category: "action",
  description:
    "Single agent step: OpenAI-compatible chat by default, or optional Python AutoGen bridge via pythonModulePath.",
  configSchema:
    AutogenAgentConfigSchema as unknown as import("zod").ZodType<
      Record<string, unknown>
    >,
  outputSchema:
    AutogenAgentOutputSchema as unknown as import("zod").ZodType<
      Record<string, unknown>
    >,
  execute: async ({ config, inputData, context, agentToolDispatch }) => {
    const c0 = AutogenAgentConfigSchema.parse(config);
    const c = mergeAutogenAgentConfigWithLibrary(
      c0,
      context.variables as Record<string, unknown> | undefined,
    );
    const upstream = inputData as Record<string, unknown>;

    const req = c.requiredUpstreamFields;
    if (req?.length) {
      const check = validateRequiredFields(upstream, req);
      if (!check.success) {
        const fail = {
          success: false as const,
          error: check.error,
          missingFields: check.missingFields,
          message: check.message,
        };
        AutogenAgentOutputSchema.parse(fail);
        return fail;
      }
    }

    const promptText = c.systemPrompt?.trim() ?? "";
    if (promptText.length < 1) {
      throw new Error(
        "autogen.agent: systemPrompt is empty; set it on the node or bind libraryAgentId and pass variables.agentLibrary",
      );
    }

    if (c.runtime === "python_autogen") {
      if (c.tools?.length) {
        context.logger.warn(
          "autogen.agent: tools are ignored when runtime is python_autogen",
          { toolCount: c.tools.length },
        );
      }
      const payload = {
        mode: "single" as const,
        agentName: c.agentName,
        systemPrompt: promptText,
        upstream,
      };
      const bridge = await runPythonAutogenBridge({
        pythonExecutable: c.pythonExecutable ?? "python3",
        modulePath: c.pythonModulePath ?? "",
        payload,
        timeoutMs: c.timeoutMs ?? 120_000,
      });
      const out = {
        success: bridge.success !== false,
        runtime: "python_autogen",
        agentName: c.agentName ?? "agent",
        model: c.model ?? "gpt-4o-mini",
        output:
          typeof bridge.finalAnswer === "string"
            ? bridge.finalAnswer
            : JSON.stringify(bridge.output ?? bridge),
        raw: bridge as Record<string, unknown>,
      };
      AutogenAgentOutputSchema.parse(out);
      return out;
    }

    const { baseUrl, apiKey } = resolveOpenAiFromEnv(c);
    if (!apiKey) {
      throw new Error(
        "autogen.agent: set WFENGINE_OPENAI_API_KEY or OPENAI_API_KEY on the runner, or openAiApiKey on the node",
      );
    }

    const userContent = `Workflow payload:\n${upstreamToJsonText(upstream)}`;
    const vars = context.variables as Record<string, unknown>;
    if (c.tools?.length && c.tools.length > 0) {
      vars.__wfengineWorkflowNodeInvocationCount = 0;
    }

    const text =
      c.tools?.length && c.tools.length > 0
        ? await runOpenAiToolLoop({
            baseUrl,
            apiKey,
            model: c.model ?? "gpt-4o-mini",
            temperature: c.temperature ?? 0.3,
            timeoutMs: c.timeoutMs ?? 120_000,
            systemPrompt: promptText,
            userContent,
            tools: c.tools,
            dispatch: agentToolDispatch,
            variables: context.variables,
            openAiConfig: {
              openAiBaseUrl: c.openAiBaseUrl,
              openAiApiKey: c.openAiApiKey,
            },
          })
        : await openAiChatCompletion({
            baseUrl,
            apiKey,
            model: c.model ?? "gpt-4o-mini",
            messages: [
              { role: "system", content: promptText },
              { role: "user", content: userContent },
            ],
            temperature: c.temperature ?? 0.3,
            timeoutMs: c.timeoutMs ?? 120_000,
          });

    const wfNodeTools = (c.tools ?? []).filter((t) => t.kind === "workflow_node");
    if (wfNodeTools.length > 0) {
      const invRaw = vars.__wfengineWorkflowNodeInvocationCount;
      const inv =
        typeof invRaw === "number" && Number.isFinite(invRaw) ? invRaw : 0;
      if (inv < 1) {
        throw formatAgentOrchestrationFailure({
          nodeType: "autogen.agent",
          phase: "workflow_tools",
          underlyingMessage: `Configured ${wfNodeTools.length} workflow_node tool(s) (${wfNodeTools.map((x) => x.nodeId).join(", ")}), but the model did not call any of them.`,
        });
      }
    }

    context.logger.info("autogen.agent: completed openai_compatible run");

    const out = {
      success: true,
      runtime: "openai_compatible",
      agentName: c.agentName ?? "agent",
      model: c.model ?? "gpt-4o-mini",
      output: text,
    };
    AutogenAgentOutputSchema.parse(out);
    return out;
  },
};
