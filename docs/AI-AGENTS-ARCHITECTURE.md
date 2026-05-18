# AI Agents architecture (wfengine × AutoGen-style tools)

This document is the **foundation** for evolving wfengine Studio toward **multi-agent workflows with tools**, inspired by AutoGen Studio, while keeping **simple linear workflows** unchanged.

---

## Design principles

| Principle | Meaning |
|-----------|---------|
| **Simple mode preserved** | Users who never open Agent Library or tools get the same palette + DAG behavior as today. |
| **Opt-in complexity** | Tools, library agents, and team builders are **optional** config fields with safe defaults. |
| **One workflow graph** | Tools reference **existing canvas node ids** or **library ids** — no second hidden graph in v1. |
| **Phased execution** | **Phase 1** (this doc + schemas): validate config, Studio palette, library file shape. **Phase 2+**: executor tool loop, ag2/MAF backends. |

---

## Config schemas (implemented)

### Tool references (`AgentToolRefSchema`)

Declared in `@wfengine/nodes-agents` (`agent-tools.schema.ts`).

```text
kind: "workflow_node" | "library_agent"
```

| Kind | Fields | Meaning |
|------|--------|---------|
| `workflow_node` | `nodeId`, optional `displayName`, `description` | Target is a **node id** in the **same** `WorkflowDefinition`. At execution time, a tool runner resolves the node type + config and invokes it (Phase 2). |
| `library_agent` | `agentId` (UUID), optional display/description | Target is an **Agent Library** entry (`AgentLibraryEntrySchema`). Allows nested agent personas without duplicating prompts on the canvas. |

### `autogen.agent` extensions

Existing fields unchanged. **Optional** additions:

| Field | Type | Purpose |
|-------|------|---------|
| `tools` | `AgentToolRef[]` | Tools the single agent may call (when executor supports it). |
| `libraryAgentId` | UUID | Optional binding to a library row for default name/model/prompt merge in Studio. |

### `autogen.multi-agent` extensions

| Field | Type | Purpose |
|-------|------|---------|
| `tools` | `AgentToolRef[]` | Team-level tools (shared). |
| `stopMode` | `max_turns` \| `termination_token` | Today only **`max_turns`** is honored; **`termination_token`** reserved for coordinator-style stop (Phase 2+). |

### Agent Library (Studio persistence)

**Not** part of the workflow DAG JSON — separate document so users can reuse agents across workflows.

`AgentLibraryDocumentSchema`:

```json
{
  "schemaVersion": 1,
  "agents": [
    {
      "id": "uuid",
      "name": "Research bot",
      "systemPrompt": "...",
      "model": "gpt-4o-mini",
      "defaultTools": [],
      "provider": "openai"
    }
  ]
}
```

Studio will store this as a tab/sidebar (implementation roadmap); executors receive **resolved** inline config after merge.

---

## How agents discover and call nodes as tools

### Discovery

1. **Canvas nodes** — Studio lists every node in the current workflow with `id`, `type`, and optional label from palette. Only ids that **exist** in `definition.nodes` are valid `workflow_node` tool refs.
2. **Library** — Studio lists `AgentLibraryDocument.agents` for `library_agent` refs.

### Calling model (Phase 2 executor — specification)

When an agent node runs with `tools.length > 0`:

1. Build a **tool manifest** (name, description, JSON schema or freeform payload) for the LLM / ag2 bridge.
2. On each **tool call** from the model:
   - **`workflow_node`**: Load node `(id, type, config)` from the same definition; run **one** `WorkflowEngine` execution of **that** node with `inputData = tool arguments` merged with safe defaults (read-only context snapshot).
   - **`library_agent`**: Resolve library entry; treat as a nested **single-agent** sub-run (or expand inline prompts).
3. Append tool results to the conversation / transcript; continue until `stopMode` / `maxTurns` / model stop.

**Cycles & safety:** Tool runner must track depth and forbid arbitrary graph traversal without caps (document in Phase 2 PR).

### Current runtime behavior (Phase 1)

Existing `@wfengine/nodes-agents` execute paths **ignore** `tools` for orchestration but **parse and persist** them in workflow JSON. Logs may note that tool loops are not yet active — behavior identical to pre-schema upgrade when `tools` is omitted.

---

## UI / Studio roadmap

| Milestone | Deliverable |
|-----------|-------------|
| **Done (Phase 1)** | Zod schemas + exports; palette category **“AI Agents”**; example skeleton workflow JSON. |
| **Next** | Agent Library panel (CRUD + import/export `AgentLibraryDocument`); tool picker with search + node previews. |
| **Then** | Team builder for `autogen.multi-agent` (drag agents from library + inline rows); termination UX. |
| **Executor** | Tool loop in Node or delegate to **Python ag2** module with same stdin/stdout bridge pattern as today. |

---

## Backend alignment

| Backend | Role |
|---------|------|
| **OpenAI-compatible HTTP** (today) | Chat + future **function calling** mapping to `tools`. |
| **Python `python_autogen` bridge** (today) | Extend payload to include tool definitions + tool results (Phase 2). |
| **ag2 / MAF** | Optional dedicated worker image or optional dependency group — same **merged `inputData`** contract as other nodes. |

---

## Related files

- `packages/nodes-agents/src/agent-tools.schema.ts` — tool + library shapes  
- `packages/nodes-agents/src/schemas.ts` — `autogen.*` extensions  
- `apps/studio/src/palette-data.ts` — **AI Agents** palette category  
- `examples/workflows/agent-with-tools-skeleton.json` — sample graph  

---

## Non-goals (for clarity)

- Replacing React Flow or the DAG executor’s topological model.  
- Embedding AutoGen Studio’s database — wfengine keeps **Postgres workflow versions** as today.  
- Requiring all users to configure agents — **noop / HTTP / …** stay default “simple” path.
