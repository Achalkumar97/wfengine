# @wfengine/nodes-agents

Visual workflow nodes for **multi-agent AI** orchestration in wfengine.

## Architecture

| Concept | Role |
|--------|------|
| **Microsoft Agent Framework (MAF)** | Official frameworks target **.NET** and **Python** ([Learn](https://learn.microsoft.com/agent-framework/)). This package implements **MAF-style** orchestration in **Node.js**: multiple personas, shared workflow context, structured transcripts — using an **OpenAI-compatible** HTTP API so it works with Azure OpenAI, OpenAI, and compatible gateways. |
| **AutoGen / ag2** | Primary libraries are **Python**. The `python_autogen` runtime calls **`python -m <your.module>`** with JSON on **stdin** and expects JSON on **stdout** so you can embed real AutoGen teams on the runner. |

Execution remains standard **`WorkflowEngine`**: nodes receive merged **`inputData`** and return objects for downstream steps.

## Nodes

| Type | Purpose |
|------|---------|
| `mfa.agent-group` | Configurable group of agents; sequential multi-turn or single JSON completion. |
| `autogen.agent` | Single agent; OpenAI chat or Python bridge. |
| `autogen.multi-agent` | 2+ agents; round-robin in Node or Python bridge. |

## Environment

- **`OPENAI_API_KEY`** or **`WFENGINE_OPENAI_API_KEY`** — used when node config does not set `openAiApiKey`.
- **`WFENGINE_OPENAI_BASE_URL`** — optional base URL for compatible endpoints.
- **Ollama without an OpenAI key:** if those keys are unset, set **`OLLAMA_BASE_URL`** or **`WFENGINE_OLLAMA_BASE_URL`** to your OpenAI-compatible base (e.g. `http://127.0.0.1:11434/v1`). Optional **`OLLAMA_MODEL`** / **`WFENGINE_OLLAMA_MODEL`**; if the node still says `gpt-4o-mini`, the runtime maps to a local Ollama model when needed.

## Gen-AI tools vs node graph (`workflow_node` + `wfengineToolOnly`)

- **One combined graph**: nodes are normal workflow steps *or* callable as LLM tools via `workflow_node` refs on the multi-agent node. `wfengineToolOnly: true` only means “do not also run this node as a regular topological step” so file/email are not executed twice (once by DAG, once by the tool).
- **OpenAI default** uses `tool_choice: "auto"`, so the model may answer with **plain text** and never emit `tool_calls`. If an agent-invoke-only step is never dispatched, the engine **fails the run with a clear error** (no silent skip).
- **`multiAgentToolBinding`** omitted → runtime **infers** `pipeline_last_turn_tools_required` when tools reference **agent-invoke-only** graph nodes and **`maxTurns ===` number of agents** (one turn per persona).
- Explicit **`pipeline_last_turn_tools_required`** makes the **last** turn’s first completion use `tool_choice: required`.
- **Pure linear DAG** (every step in order): clear `wfengineToolOnly` on those nodes and use normal edges (see `weather-10d-report-email.json`).

## Python bridge contract

Implement a module that reads one JSON object from stdin and prints one JSON object to stdout:

```json
{
  "success": true,
  "transcript": [{ "agent": "a1", "content": "..." }],
  "finalAnswer": "...",
  "output": {}
}
```

Point **`pythonModulePath`** at your package’s runnable module (e.g. `company.autogen_runner`).

## Registration

```typescript
import { WorkflowEngine } from "@wfengine/core";
import { registerBuiltinNodes } from "@wfengine/nodes-base";
import { registerAgentNodes } from "@wfengine/nodes-agents";

const engine = new WorkflowEngine();
registerBuiltinNodes(engine);
registerAgentNodes(engine);
```

The server already registers these when `@wfengine/nodes-agents` is linked.
