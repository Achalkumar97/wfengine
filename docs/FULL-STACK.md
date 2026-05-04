# Full stack and tooling

This monorepo is a **TypeScript-first** workflow engine with optional **REST + database + queue** hosting and a **React** visual editor.

## Runtime and build

| Technology | Version (typical) | Role |
|------------|-------------------|------|
| **Node.js** | ≥ 18.18 | Runs the engine, server, workers, and build tools |
| **npm** | ≥ 9 (workspaces) | Package manager; hoists dependencies across `packages/*`, `apps/*`, `examples/*` |
| **TypeScript** | 5.7+ | Source language; packages emit to `dist/` |
| **Turborepo** | 2.x | Orchestrates `build` / `test` with dependency order (`^build`) |

## Core libraries (`packages/`)

| Package | Stack inside | Purpose |
|---------|----------------|---------|
| **@wfengine/shared** | Zod | Workflow JSON schema, `parseWorkflow`, API request/response types |
| **@wfengine/core** | — | `WorkflowEngine`: topological execution, retries, `agentToolDispatch` for LLM tool calls |
| **@wfengine/nodes-base** | nodemailer, pg, IMAP, etc. (see package) | Built-in nodes: HTTP, email, Slack, Postgres, files, `noop` |
| **@wfengine/nodes-agents** | OpenAI-compatible HTTP, optional Python bridge | `autogen.agent`, `autogen.multi-agent`, MAF-style groups |
| **@wfengine/ui** | React, React Flow | Canvas, export to JSON, shared node chrome |

## Apps (`apps/`)

| App | Stack | Purpose |
|-----|--------|---------|
| **@wfengine/server** | **Fastify** 5, **Prisma** 6, **BullMQ** 5, **ioredis** | REST API, persist workflows/executions in **PostgreSQL**, async runs via **Redis** queue, webhooks, cron |
| **examples-studio** (folder `apps/studio`) | **Vite** 6, **React** 18, **React Flow** 11, **Tailwind** 4, **Radix** UI, **Zod**, **react-hook-form** | wfengine Studio: visual editor, run inline definition, optional publish to API |

## Data stores (hosted mode)

| Store | Role |
|-------|------|
| **PostgreSQL** | Prisma: workflow containers, versions, executions, logs |
| **Redis** | BullMQ: job queue for async executions and repeatable cron jobs |

## Optional / integration

| Piece | When |
|-------|------|
| **Python 3** | `python_autogen` runtime on agent nodes; `PYTHONPATH` for bridge modules |
| **Docker Compose** | Local Postgres + Redis (`infra/docker-compose.yml`) |
| **OpenAI-compatible API** | LLM nodes; env `OPENAI_API_KEY` / `WFENGINE_OPENAI_*` |

## What is *not* bundled as a single runtime

- There is no JVM/.NET runtime in the default stack; **Microsoft Agent Framework** is referenced conceptually in docs — Node implements MAF-style orchestration.
- **Studio** does not embed Postgres; it talks to the API when configured (or runs workflows via inline POST through Vite proxy).

## Dependency direction (high level)

```text
Studio / Server / examples  →  @wfengine/core + nodes-* + shared + ui
@wfengine/core              →  @wfengine/shared
@wfengine/nodes-base        →  @wfengine/core, @wfengine/shared
@wfengine/nodes-agents      →  @wfengine/core, @wfengine/shared
@wfengine/server            →  core, nodes-base, nodes-agents, shared, Prisma, Fastify, BullMQ
```

For a **minimal embed**: install `@wfengine/core` and `@wfengine/shared` only; register your own node types or add `@wfengine/nodes-base` for built-ins.
