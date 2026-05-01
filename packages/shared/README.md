# @wfengine/shared

Zod schemas and TypeScript types for workflow JSON and API payloads.

- **`WorkflowDefinitionSchema`** / **`parseWorkflow`** — graph shape (`nodes`, `edges`).
- **`CreateWorkflowVersionBodySchema`**, **`StartExecutionBodySchema`** — used by `@wfengine/server`.

```typescript
import { parseWorkflow } from "@wfengine/shared";

const wf = parseWorkflow(json);
```
