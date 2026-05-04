import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { NodeProgressEvent, WorkflowEngine } from "@wfengine/core";
import { parseWorkflow, RunInlineDefinitionBodySchema } from "@wfengine/shared";

/**
 * Execute a workflow JSON synchronously without saving a WorkflowVersion row.
 */
export async function registerRunsInlineRoutes(
  app: FastifyInstance,
  engine: WorkflowEngine,
): Promise<void> {
  app.post("/runs/inline", async (request, reply) => {
    const body = RunInlineDefinitionBodySchema.parse(request.body);
    const execOpts =
      body.agentLibrary !== undefined
        ? { variables: { agentLibrary: body.agentLibrary } }
        : {};
    const result = body.singleNodeRun
      ? await engine.executeSingleNode(
          body.definition,
          body.singleNodeRun.nodeId,
          body.singleNodeRun.seedOutputs,
          body.initialData ?? undefined,
          execOpts,
        )
      : await engine.execute(
          body.definition,
          body.initialData ?? undefined,
          execOpts,
        );
    reply.send(result);
  });

  /**
   * Same as POST /runs/inline but streams NDJSON events (one JSON object per line)
   * for live node progress, then a final `run_finished` line with the full result.
   */
  app.post("/runs/inline/stream", async (request, reply) => {
    const body = RunInlineDefinitionBodySchema.parse(request.body);
    const wf = parseWorkflow(body.definition);
    const stream = new PassThrough();
    const startedAt = new Date().toISOString();
    const executionId = randomUUID();

    stream.write(
      JSON.stringify({
        type: "run_started" as const,
        executionId,
        workflowId: wf.id,
        startedAt,
      }) + "\n",
    );

    const writeProgress = (ev: NodeProgressEvent) => {
      if (ev.phase === "start") {
        stream.write(
          JSON.stringify({
            type: "node_start" as const,
            nodeId: ev.nodeId,
            nodeType: ev.nodeType,
          }) + "\n",
        );
        return;
      }
      stream.write(
        JSON.stringify({
          type: "node_complete" as const,
          nodeId: ev.nodeId,
          nodeType: ev.nodeType,
          ok: ev.ok === true,
          error: ev.error,
        }) + "\n",
      );
    };

    const execOpts = {
      executionId,
      onNodeProgress: writeProgress,
      ...(body.agentLibrary !== undefined
        ? { variables: { agentLibrary: body.agentLibrary } }
        : {}),
    };

    const pump = async () => {
      try {
        const result = body.singleNodeRun
          ? await engine.executeSingleNode(
              body.definition,
              body.singleNodeRun.nodeId,
              body.singleNodeRun.seedOutputs,
              body.initialData ?? undefined,
              execOpts,
            )
          : await engine.execute(
              body.definition,
              body.initialData ?? undefined,
              execOpts,
            );
        stream.write(
          JSON.stringify({ type: "run_finished" as const, result }) + "\n",
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        stream.write(
          JSON.stringify({ type: "run_error" as const, message }) + "\n",
        );
      } finally {
        stream.end();
      }
    };

    void pump();

    reply
      .header("Content-Type", "application/x-ndjson; charset=utf-8")
      .header("Cache-Control", "no-cache");
    return reply.send(stream);
  });
}
