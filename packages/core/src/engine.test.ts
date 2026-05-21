import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "@wfengine/shared";
import { WorkflowEngine } from "./engine.js";
import type { NodeDefinition } from "./node.types.js";

const noop: NodeDefinition = {
  type: "noop",
  label: "Noop",
  execute: async ({ inputData }) => ({ ...inputData, noop: true }),
};

describe("WorkflowEngine", () => {
  it("runs two-node workflow", async () => {
    const engine = new WorkflowEngine();
    engine.registerNode(noop);

    const wf: WorkflowDefinition = {
      id: "wf-1",
      nodes: [
        { id: "n1", type: "noop", config: {} },
        { id: "n2", type: "noop", config: {} },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };

    const result = await engine.execute(wf, { hello: "world" });
    expect(result.status).toBe("completed");
    expect(result.outputs["n1"]).toMatchObject({ hello: "world", noop: true });
    expect(result.outputs["n2"]).toMatchObject({
      hello: "world",
      noop: true,
    });
  });

  it("throws on unknown node type", async () => {
    const engine = new WorkflowEngine();
    const wf: WorkflowDefinition = {
      id: "wf",
      nodes: [{ id: "x", type: "missing", config: {} }],
      edges: [],
    };
    await expect(engine.execute(wf)).rejects.toThrow(/Unknown node type/);
  });

  it("retries then succeeds", async () => {
    let calls = 0;
    const flaky: NodeDefinition = {
      type: "flaky",
      label: "Flaky",
      execute: async () => {
        calls++;
        if (calls < 2) throw new Error("fail");
        return { ok: true };
      },
    };

    const engine = new WorkflowEngine();
    engine.registerNode(flaky);

    const wf: WorkflowDefinition = {
      id: "wf",
      nodes: [{ id: "a", type: "flaky", config: {} }],
      edges: [],
    };

    const result = await engine.execute(wf, {}, { retries: { maxAttempts: 3 } });
    expect(result.status).toBe("completed");
    expect(calls).toBe(2);
  });

  it("continue on error", async () => {
    const bad: NodeDefinition = {
      type: "bad",
      label: "Bad",
      execute: async () => {
        throw new Error("boom");
      },
    };
    const engine = new WorkflowEngine();
    engine.registerNode(noop);
    engine.registerNode(bad);

    const wf: WorkflowDefinition = {
      id: "wf",
      nodes: [
        { id: "b", type: "bad", config: {} },
        { id: "n", type: "noop", config: {} },
      ],
      edges: [{ source: "b", target: "n" }],
    };

    const result = await engine.execute(wf, {}, { onNodeError: "continue" });
    expect(result.status).toBe("partial");
    expect(result.outputs["n"]).toBeDefined();
  });

  it("treats structured success:false as node failure", async () => {
    const validating: NodeDefinition = {
      type: "validating",
      label: "Validating",
      execute: async () => ({
        success: false as const,
        error: "Missing required fields",
        missingFields: ["runDate"],
        message: "Please provide runDate in the initial payload.",
      }),
    };
    const engine = new WorkflowEngine();
    engine.registerNode(validating);

    const wf: WorkflowDefinition = {
      id: "wf",
      nodes: [{ id: "v", type: "validating", config: {} }],
      edges: [],
    };

    const progress: { ok?: boolean }[] = [];
    const result = await engine.execute(wf, {}, {
      onNodeProgress: (ev) => {
        if (ev.phase === "complete") progress.push({ ok: ev.ok });
      },
    });

    expect(result.status).toBe("failed");
    expect(result.errors["v"]).toContain("runDate");
    expect(result.errors["v"]).toContain("Missing required fields");
    expect(progress).toEqual([{ ok: false }]);
  });

  it("calls onNodeProgress start/complete per node", async () => {
    const engine = new WorkflowEngine();
    engine.registerNode(noop);

    const wf: WorkflowDefinition = {
      id: "wf",
      nodes: [
        { id: "a", type: "noop", config: {} },
        { id: "b", type: "noop", config: {} },
      ],
      edges: [{ source: "a", target: "b" }],
    };

    const events: string[] = [];
    await engine.execute(wf, {}, {
      onNodeProgress: (ev) => {
        events.push(
          `${ev.phase}:${ev.nodeId}:${ev.ok === undefined ? "" : ev.ok ? "y" : "n"}`,
        );
      },
    });

    expect(events).toEqual([
      "start:a:",
      "complete:a:y",
      "start:b:",
      "complete:b:y",
    ]);
  });

  it("preserves agent-invoked output for wfengineToolOnly nodes (does not overwrite with linear skip)", async () => {
    const invokesTool: NodeDefinition = {
      type: "invokes-tool",
      label: "Invokes tool",
      execute: async ({ agentToolDispatch }) => {
        if (!agentToolDispatch) throw new Error("expected agentToolDispatch");
        const out = await agentToolDispatch.executeWorkflowNode("t1", {
          v: 42,
        });
        return { agent: true, toolOut: out };
      },
    };
    const toolTarget: NodeDefinition = {
      type: "tool-target",
      label: "Tool target",
      execute: async ({ inputData }) => ({ fromTool: true, inputData }),
    };

    const engine = new WorkflowEngine();
    engine.registerNode(invokesTool);
    engine.registerNode(toolTarget);

    const wf: WorkflowDefinition = {
      id: "wf-tool-preserve",
      nodes: [
        { id: "agent", type: "invokes-tool", config: {} },
        {
          id: "t1",
          type: "tool-target",
          config: { wfengineToolOnly: true },
        },
      ],
      edges: [{ source: "agent", target: "t1" }],
    };

    const result = await engine.execute(wf, {});
    expect(result.status).toBe("completed");
    expect(result.outputs["t1"]).toMatchObject({
      fromTool: true,
      inputData: expect.objectContaining({ v: 42 }),
    });
    expect((result.outputs["t1"] as Record<string, unknown>).__wfengineToolOnly).toBe(
      undefined,
    );
  });

  it("does not re-run a downstream node already invoked by an agent tool", async () => {
    let targetCalls = 0;
    const invokesTool: NodeDefinition = {
      type: "invokes-tool-once",
      label: "Invokes tool once",
      execute: async ({ agentToolDispatch }) => {
        if (!agentToolDispatch) throw new Error("expected agentToolDispatch");
        const out = await agentToolDispatch.executeWorkflowNode("notify", {
          text: "hello",
        });
        return { agent: true, toolOut: out };
      },
    };
    const notifyTarget: NodeDefinition = {
      type: "notify-target",
      label: "Notify target",
      execute: async ({ inputData }) => {
        targetCalls++;
        return { sent: true, text: inputData.text, targetCalls };
      },
    };

    const engine = new WorkflowEngine();
    engine.registerNode(invokesTool);
    engine.registerNode(notifyTarget);

    const wf: WorkflowDefinition = {
      id: "wf-tool-no-duplicate",
      nodes: [
        { id: "agent", type: "invokes-tool-once", config: {} },
        { id: "notify", type: "notify-target", config: {} },
      ],
      edges: [{ source: "agent", target: "notify" }],
    };

    const result = await engine.execute(wf, {});

    expect(result.status).toBe("completed");
    expect(targetCalls).toBe(1);
    expect(result.outputs["notify"]).toMatchObject({
      sent: true,
      text: "hello",
      targetCalls: 1,
    });
  });

  it("fails with explicit error when wfengineToolOnly node was not agent-invoked", async () => {
    const engine = new WorkflowEngine();
    engine.registerNode(noop);
    const wf: WorkflowDefinition = {
      id: "wf-tool-miss",
      nodes: [
        { id: "a", type: "noop", config: {} },
        { id: "t1", type: "noop", config: { wfengineToolOnly: true } },
      ],
      edges: [{ source: "a", target: "t1" }],
    };
    const result = await engine.execute(wf, {});
    expect(result.status).toBe("failed");
    expect(result.errors["t1"]).toMatch(/agent-invoke-only/);
    expect(
      (result.outputs["t1"] as Record<string, unknown>).__wfengine_error,
    ).toBeDefined();
  });

  it("records partial status when wfengineToolOnly miss and onNodeError is continue", async () => {
    const engine = new WorkflowEngine();
    engine.registerNode(noop);
    const wf: WorkflowDefinition = {
      id: "wf-tool-miss-cont",
      nodes: [
        { id: "a", type: "noop", config: {} },
        { id: "t1", type: "noop", config: { wfengineToolOnly: true } },
        { id: "b", type: "noop", config: {} },
      ],
      edges: [
        { source: "a", target: "t1" },
        { source: "t1", target: "b" },
      ],
    };
    const result = await engine.execute(wf, {}, { onNodeError: "continue" });
    expect(result.status).toBe("partial");
    expect(result.errors["t1"]).toMatch(/workflow_node tool/);
    expect(result.outputs["b"]).toBeDefined();
  });
});
