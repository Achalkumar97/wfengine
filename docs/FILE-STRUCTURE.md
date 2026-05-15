# Repository file structure

Monorepo root: **`workflow-engine-sdk`** (npm workspaces: `packages/*`, `apps/*`, `examples/*`).

## Top level

| Path | Purpose |
|------|---------|
| `package.json` | Root scripts: `build`, `test`, `dev:server`, `dev:studio`, `db:*` |
| `turbo.json` | Turborepo task graph (`build` depends on `^build`) |
| `.env` / `.env.example` | Single template at repo root; Studio `VITE_*` copied into `apps/studio/.env` |
| `infra/docker-compose.yml` | Optional local **PostgreSQL** + **Redis** |
| `README.md` | Primary quick start and API overview |
| `docs/` | Extended documentation (this folder) |

## `packages/` — publishable libraries

```
packages/
├── shared/          # Zod schemas, workflow types, DAG helpers, server DTOs
├── core/            # WorkflowEngine, executor, agent tool dispatch
├── nodes-base/      # HTTP, email, Slack, Postgres, file, noop, …
├── nodes-agents/    # LLM / multi-agent / Python bridge nodes
└── ui/              # React Flow canvas, exportWorkflowDefinition
```

Each package typically has `src/`, `package.json`, `tsconfig.json`, built output in **`dist/`** after `npm run build`.

## `apps/` — applications

```
apps/
├── server/          # @wfengine/server — Fastify API, Prisma, BullMQ worker entry
│   ├── prisma/        # schema + migrations
│   └── src/           # routes, engine wiring, worker.ts
└── studio/            # package name: examples-studio — Vite + React Studio UI
    └── src/           # App.tsx, NodeConfigPanel, Run inspector, palette
```

## `examples/` — samples

```
examples/
├── programmatic/    # Minimal script: engine-only demo (`npm run example` from root)
├── studio/          # Pointer README for dev:studio (app lives in apps/studio)
├── workflows/       # JSON workflow definitions for import / reference
└── python-autogen-bridge/  # Optional Python bridge package for agent nodes
```

## Where to change what

| Goal | Start here |
|------|------------|
| New built-in integration node | `packages/nodes-base/src/` + register in package index |
| New LLM / agent behavior | `packages/nodes-agents/src/` |
| Execution semantics | `packages/core/src/` |
| Workflow JSON shape | `packages/shared/src/workflow.schema.ts` |
| REST routes | `apps/server/src/routes/` |
| Studio UI | `apps/studio/src/` |
| Canvas / export | `packages/ui/src/` |

## Import aliases in apps

Apps depend on workspace packages by name, for example `@wfengine/core`, `@wfengine/shared`. After clone, run **`npm install`** at the repo root so workspaces link correctly.
