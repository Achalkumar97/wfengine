import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { NodeProgressEvent, WorkflowEngine } from "@wfengine/core";
import { parseWorkflow, RunInlineDefinitionBodySchema } from "@wfengine/shared";
import { ZodError } from "zod";

/**
 * Execute a workflow JSON synchronously without saving a WorkflowVersion row.
 */
export async function registerRunsInlineRoutes(
  app: FastifyInstance,
  engine: WorkflowEngine,
): Promise<void> {
  app.post("/runs/inline", async (request, reply) => {
    try {
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
      return reply.send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({
          error: "Invalid request body",
          issues: err.flatten(),
        });
      }
      request.log.error(err);
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({
        error: message,
      });
    }
  });

  /**
   * Same as POST /runs/inline but streams NDJSON events (one JSON object per line)
   * for live node progress, then a final `run_finished` line with the full result.
   *
   * Client-side cancellation: when the browser closes the connection (e.g. the
   * user presses Stop), the underlying Node.js socket emits a 'close' event on
   * `request.raw`.  We hook that event to abort an AbortController whose signal
   * is forwarded into engine.execute() — the engine checks signal.aborted between
   * every node and throws immediately, stopping the run server-side.
   */
  app.post("/runs/inline/stream", async (request, reply) => {
    const body = RunInlineDefinitionBodySchema.parse(request.body);
    const wf = parseWorkflow(body.definition);
    const stream = new PassThrough();
    const startedAt = new Date().toISOString();
    const executionId = randomUUID();

    // ── Abort on client disconnect ──────────────────────────────────────────
    const abort = new AbortController();

    const onClientClose = () => {
      if (!abort.signal.aborted) {
        request.log.info(
          { executionId },
          "Client disconnected — aborting inline run",
        );
        abort.abort();
      }
    };

    // Node's IncomingMessage fires 'close' when the socket is fully closed.
    request.raw.on("close", onClientClose);

    // Clean up listener once we're done (success or error).
    const cleanup = () => {
      request.raw.off("close", onClientClose);
    };
    // ────────────────────────────────────────────────────────────────────────

    stream.write(
      JSON.stringify({
        type: "run_started" as const,
        executionId,
        workflowId: wf.id,
        startedAt,
      }) + "\n",
    );

    const writeProgress = (ev: NodeProgressEvent) => {
      if (abort.signal.aborted) return; // don't write to a dead stream
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
      // ← This is the key: forward the AbortSignal into the engine.
      // engine.execute() propagates it to every node executor which checks
      // signal.aborted before and between nodes.
      signal: abort.signal,
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

        if (!abort.signal.aborted) {
          stream.write(
            JSON.stringify({ type: "run_finished" as const, result }) + "\n",
          );
        }
      } catch (e) {
        // If the abort signal fired, treat it as a user cancellation — don't
        // try to write to the stream (the client is already gone).
        if (abort.signal.aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        stream.write(
          JSON.stringify({ type: "run_error" as const, message }) + "\n",
        );
      } finally {
        cleanup();
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
