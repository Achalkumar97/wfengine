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
});
