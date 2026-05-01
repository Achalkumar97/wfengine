# @wfengine/core

Workflow **DAG execution engine**: `WorkflowEngine`, `NodeRegistry`, topological sort, retries, logging, and optional **`inputSchema` / `outputSchema`** on `NodeDefinition` for tooling.

- **No** database, HTTP server, or UI dependencies.
- Pair with `@wfengine/shared` for `parseWorkflow` / JSON validation.

```typescript
import { WorkflowEngine } from "@wfengine/core";

const engine = new WorkflowEngine();
engine.registerNode(myNode);
await engine.execute(workflowJson, initialData);
```

See the [repository README](../../README.md) for full usage.
