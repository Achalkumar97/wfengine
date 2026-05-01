import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "@wfengine/shared";
import { buildInputData } from "./executor.js";

describe("buildInputData", () => {
  it("merges gitOwner/gitRepo from ancestors when the immediate parent omits them", () => {
    const wf: WorkflowDefinition = {
      id: "w",
      nodes: [
        { id: "analyze", type: "noop", config: {} },
        { id: "middle", type: "noop", config: {} },
        { id: "leaf", type: "noop", config: {} },
      ],
      edges: [
        { source: "analyze", target: "middle" },
        { source: "middle", target: "leaf" },
      ],
    };
    const outputs = new Map<string, unknown>();
    outputs.set("analyze", {
      gitOwner: "acme",
      gitRepo: "demo",
      gitRef: "main",
    });
    outputs.set("middle", { step: "middle" });
    const input = buildInputData(wf, "leaf", outputs, {}, wf.edges);
    expect(input.gitOwner).toBe("acme");
    expect(input.gitRepo).toBe("demo");
    expect(input.gitRef).toBe("main");
    expect(input.step).toBe("middle");
  });
});
