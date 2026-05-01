import { WorkflowEngine } from "@wfengine/core";
import type { WorkflowDefinition } from "@wfengine/shared";
import { registerBuiltinNodes } from "@wfengine/nodes-base";

async function main(): Promise<void> {
  const engine = new WorkflowEngine();
  registerBuiltinNodes(engine);

  const workflow: WorkflowDefinition = {
    id: "wf-demo",
    version: 1,
    nodes: [
      {
        id: "hook",
        type: "trigger.webhook",
        config: {},
      },
      {
        id: "fetch",
        type: "http.request",
        config: {
          url: "https://httpbin.org/get",
          method: "GET",
          timeoutMs: 15_000,
        },
      },
    ],
    edges: [{ source: "hook", target: "fetch" }],
  };

  const result = await engine.execute(workflow, {
    message: "hello from wfengine programmatic example",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
