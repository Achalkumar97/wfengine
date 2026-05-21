import type { NodeDefinition } from "@wfengine/core";
import { WebClient } from "@slack/web-api";
import { z } from "zod";
import {
  SlackSendConfigSchema,
  SlackSendOutputSchema,
} from "./config-schemas.js";
import { redactSecretsDeep } from "./redact-secrets.js";
import { interpolateTemplateTwice } from "./template-interpolate.js";

export {
  SlackSendConfigSchema,
  SlackSendOutputSchema,
} from "./config-schemas.js";

export type SlackSendConfig = z.infer<typeof SlackSendConfigSchema>;

/** Slack chat.postMessage `text` safety margin below API limits */
const SLACK_TEXT_SAFE_MAX = 38_000;

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

/** Full merged upstream payload as pretty-printed JSON for Slack body */
function formatUpstreamPayloadForSlack(data: Record<string, unknown>): string {
  try {
    let s = JSON.stringify(data, jsonReplacer, 2);
    if (s.length > SLACK_TEXT_SAFE_MAX) {
      s = `${s.slice(0, SLACK_TEXT_SAFE_MAX)}\n\n… (truncated for Slack length limit)`;
    }
    return s;
  } catch {
    return `[non-JSON upstream payload] ${String(data)}`;
  }
}

export const slackSendNode: NodeDefinition = {
  type: "slack.send",
  label: "Send Slack message",
  category: "action",
  description:
    "Post to a channel using a Bot User OAuth token (xoxb-...). Leave the message empty to send the full upstream JSON payload; otherwise set text and optional {{placeholders}}.",
  configSchema:
    SlackSendConfigSchema as unknown as z.ZodType<Record<string, unknown>>,
  outputSchema:
    SlackSendOutputSchema as unknown as z.ZodType<Record<string, unknown>>,
  execute: async ({ config, inputData, context }) => {
    const c = SlackSendConfigSchema.parse(config);
    const client = new WebClient(c.token);

    const mergedIn = inputData as Record<string, unknown>;
    const safeIn = redactSecretsDeep(mergedIn) as Record<string, unknown>;
    const template = typeof c.text === "string" ? c.text : "";
    const trimmed = template.trim();

    let text: string;
    if (trimmed.length === 0) {
      text = formatUpstreamPayloadForSlack(safeIn);
    } else if (c.interpolateFromInput) {
      text = interpolateTemplateTwice(template, safeIn);
    } else {
      text = template;
    }

    // Validate that text is non-empty after interpolation/fallback
    if (!text || text.trim().length === 0) {
      throw new Error(
        "slack.send: message text is empty after template interpolation and upstream payload fallback. Either provide a non-empty text field in config, or ensure upstream inputData contains meaningful data for the fallback payload.",
      );
    }

    context.logger.info("Slack chat.postMessage", { channel: c.channel });

    const res = await client.chat.postMessage({
      channel: c.channel,
      text,
      thread_ts: c.threadTs,
      mrkdwn: c.mrkdwn,
    });

    if (!res.ok) {
      throw new Error(res.error ?? "Slack API error");
    }

    const out = {
      ok: true as const,
      ts: res.ts,
      channel: res.channel,
    };
    SlackSendOutputSchema.parse(out);
    return out;
  },
};
