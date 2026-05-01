import { describe, expect, it } from "vitest";
import type { Edge, Node } from "reactflow";
import type { WfNodeData } from "./exportWorkflow.js";
import { exportWorkflowDefinition } from "./exportWorkflow.js";

describe("exportWorkflowDefinition", () => {
  it("builds valid workflow JSON", () => {
    const nodes: Node<WfNodeData>[] = [
      {
        id: "a",
        position: { x: 0, y: 0 },
        data: {
          wfType: "noop",
          label: "noop",
          config: {},
        },
      },
      {
        id: "b",
        position: { x: 100, y: 0 },
        data: {
          wfType: "noop",
          label: "noop",
          config: {},
        },
      },
    ];
    const edges: Edge[] = [{ id: "e", source: "a", target: "b" }];
    const wf = exportWorkflowDefinition("wf-1", 1, nodes, edges);
    expect(wf.id).toBe("wf-1");
    expect(wf.edges).toHaveLength(1);
    expect(wf.nodes[0]?.type).toBe("noop");
  });
});
