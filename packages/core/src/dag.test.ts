import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "@wfengine/shared";
import { CyclicWorkflowError } from "./errors.js";
import { topologicalSort } from "./dag.js";

describe("topologicalSort", () => {
  it("orders linear chain", () => {
    const wf: WorkflowDefinition = {
      id: "w",
      nodes: [
        { id: "a", type: "noop", config: {} },
        { id: "b", type: "noop", config: {} },
        { id: "c", type: "noop", config: {} },
      ],
      edges: [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    };
    expect(topologicalSort(wf)).toEqual(["a", "b", "c"]);
  });

  it("detects cycle", () => {
    const wf: WorkflowDefinition = {
      id: "w",
      nodes: [
        { id: "a", type: "noop", config: {} },
        { id: "b", type: "noop", config: {} },
      ],
      edges: [
        { source: "a", target: "b" },
        { source: "b", target: "a" },
      ],
    };
    expect(() => topologicalSort(wf)).toThrow(CyclicWorkflowError);
  });
});
