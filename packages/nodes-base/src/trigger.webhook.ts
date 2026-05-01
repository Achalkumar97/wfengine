import type { ExecuteOptions, WorkflowEngine } from "@wfengine/core";
import type { WorkflowDefinition } from "@wfengine/shared";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { NodeDefinition } from "@wfengine/core";

export const webhookTriggerNode: NodeDefinition = {
  type: "trigger.webhook",
  label: "Webhook trigger",
  category: "trigger",
  description:
    "Entry node for webhook-driven runs. The HTTP body is still available to all nodes as merged workflow input; this node only records that the trigger fired.",
  execute: async () => ({
    triggered: true,
    at: new Date().toISOString(),
  }),
};

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { _raw: raw };
  }
}

export interface WebhookHandlerOptions extends ExecuteOptions {
  /** Respond before workflow finishes (fire-and-forget); default false */
  respondEarly?: boolean;
}

/**
 * Minimal Node HTTP handler: POST body becomes `initialData` for workflow execution.
 */
export function createWebhookHandler(
  engine: WorkflowEngine,
  workflow: WorkflowDefinition,
  options: WebhookHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== "POST" && req.method !== "GET") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }

    let initialData: unknown = {};
    if (req.method === "POST") {
      initialData = await readJsonBody(req);
    }

    try {
      if (options.respondEarly) {
        res.statusCode = 202;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ accepted: true }));
        await engine.execute(workflow, initialData, options);
        return;
      }

      const result = await engine.execute(workflow, initialData, options);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: message }));
    }
  };
}
