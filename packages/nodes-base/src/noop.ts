import type { NodeDefinition } from "@wfengine/core";

export const noopNode: NodeDefinition = {
  type: "noop",
  label: "No operation",
  category: "action",
  description: "Passes input through (useful for testing).",
  execute: async ({ inputData }) => ({ ...inputData }),
};
