# wfengine — Project guide (plain English)

This document explains what this repository does in everyday language, how the pieces fit together, which technologies are used (with versions taken from `package-lock.json` after `npm install`), how the database is structured, and practical tips for getting the most out of it.

---

## What is this project? (Layman’s terms)

**wfengine** is a toolkit for building **automated workflows**: chains of steps that run in order (or branching order) based on a diagram you describe in JSON.

Think of it like **connecting Lego blocks**:

1. **Triggers** answer “*when* should this run?” — for example when someone calls a special URL (**webhook**) or when a clock hits a schedule (**cron**).
2. **Actions** answer “*what* should happen next?” — for example call another website (**HTTP request**), send or read **email**, post to **Slack**, run **SQL**, read/write **files**, or use **noop** for testing.

The **Studio** (`apps/studio`) is a visual editor: you drag or click palette entries, draw edges, edit **structured forms** (aligned with **`@wfengine/nodes-base/config-schemas`**), undo/redo, and **Export JSON**. You can open **multiple workflows as tabs** (**+ New** starts an empty canvas). **Save** keeps **local drafts** in the browser (**localStorage**); **Publish** (when the server is available) stores an immutable **version** in PostgreSQL via **`POST /workflows`** and **`POST /workflows/:id/versions`**. **Library** lists local drafts and server workflows so you can reopen them. With the API running, **Run workflow** sends the graph to **`POST /runs/inline`** (optional **`VITE_WFENGINE_API`** / **`VITE_WFENGINE_API_KEY`**).

You can use wfengine in three layers (pick what you need):

| Layer | What it gives you |
|-------|-------------------|
| **Libraries only** (`@wfengine/core` + schemas + optional `@wfengine/nodes-base`) | Run workflows inside your own Node.js code — no database, no HTTP server. |
| **Execution service** (`@wfengine/server`) | Saves workflows in **PostgreSQL**, queues runs with **Redis + BullMQ**, exposes a **REST API**, webhooks, and scheduled cron ticks. |
| **Studio** | A browser UI (Vite + React + React Flow) to design graphs, run them, export JSON, save local drafts, and optionally publish versions to the REST API. |

---

## How it works — block diagram

### Big picture

```mermaid
flowchart LR
  subgraph design["Design time"]
    Studio["Studio\n(Vite + React)"]
    JSON["Workflow JSON\n(nodes + edges)"]
    Studio --> JSON
  end

  subgraph optional["Optional: hosted execution"]
    API["REST API\n(Fastify)"]
    PG[("PostgreSQL")]
    Redis[("Redis")]
    Worker["Worker process\n(BullMQ)"]
    API --> PG
    API --> Redis
    Worker --> Redis
    Worker --> PG
  end

  subgraph runtime["Run time"]
    Engine["WorkflowEngine\n(@wfengine/core)"]
    Nodes["Built-in nodes\n(@wfengine/nodes-base)"]
    JSON --> Engine
    Engine --> Nodes
    API --> Engine
    Worker --> Engine
  end
```

### Server path: from save to execution

```mermaid
flowchart TD
  A["POST /workflows — create workflow row"] --> B["POST /workflows/:id/versions — store definition JSON"]
  B --> C{"How to start?"}
  C -->|Webhook| D["POST /hooks/by-version/:versionId\nbody → initialData"]
  C -->|Cron| E["POST .../cron — repeatable job in Redis"]
  C -->|Manual / API| F["POST /executions\n(sync or async: queue)"]
  D --> G["Worker or inline run"]
  E --> G
  F --> G
  G --> H["Engine runs DAG in topological order"]
  H --> I["Execution row updated\n(status, logs, result)"]
```

### What “DAG” means here

Workflows are **directed acyclic graphs (DAGs)**: nodes are steps, edges show which outputs feed which next steps. The engine runs nodes in **topological order** (dependencies first). Data from **entry** nodes merges with your **initial** payload; downstream steps receive merged **object** outputs from upstream nodes (see README for precise merge rules).

---

## Inputs and outputs

### Whole workflow run (one “execution”)

When the engine runs a saved graph, it starts from **JSON you pass in** (the **input**) and finishes with a structured **result** (the **output**).

| Concept | Plain English | Where it appears |
|---------|----------------|-------------------|
| **Workflow input** | The payload that seeds the run: objects from your API/webhook, or `{}` if you send nothing usable. Often called **`initialData`**. | HTTP: `POST /executions` body field `initialData`; webhook: **POST body** becomes `initialData`; cron: server adds metadata such as cron flags / `firedAt`. Stored on the row as **`Execution.initialData`**. |
| **Workflow output** | The outcome of **`engine.execute`**: status, **per-node results**, errors, timings. | Stored as **`Execution.result`** (same shape as `@wfengine/core`’s **`WorkflowExecuteResult`**). Inspect with **`GET /executions/:id`**. |

**`WorkflowExecuteResult`** (what ends up inside `Execution.result`) includes:

- **`status`** — `"completed"` | `"failed"` | `"partial"`
- **`outputs`** — **object keyed by node id**: each step’s return value (or an error placeholder if the engine continues after failures)
- **`errors`** — map of node id → message when something went wrong
- **`startedAt` / `finishedAt`** — ISO timestamps  
- **`workflowId`**, **`executionId`** — identifiers from the engine run

So: **input** = what you feed the run (`initialData`); **output** = `result` with **`outputs`** telling you what each node produced.

### Inside one node (developer mental model)

Each registered node’s **`execute`** function receives **`inputData`** (merged upstream data plus, for entry nodes, the workflow input) and returns a value that becomes that node’s **output** for downstream steps. Non-object outputs can be keyed by parent id when merging (see README). You edit **per-node `config`** in Studio JSON or in the saved `definitionJson`; that is **configuration**, not the same as the runtime **input/output payload** flowing along edges.

---

## Ports, services, and direct URLs (local defaults)

Defaults below match **`.env.example`** and **`apps/studio/vite.config.ts`**. If you change **`PORT`** in `.env`, replace the old port everywhere the API appears.

### Summary: what listens on which port

| Port | Protocol | What runs there |
|------|----------|-------------------|
| **5173** | HTTP | **wfengine Studio** — Vite dev server (`npm run dev:studio`) |
| **30001** | HTTP | **REST API** — Fastify (`npm run dev:server`), controlled by **`PORT`** (default `30001`) |
| **5433** | PostgreSQL wire | **Database** — Docker Compose maps host `5433` → Postgres `5432` (**not** a browser URL; use `DATABASE_URL` / client tools) |
| **6380** | Redis protocol | **Redis** — Compose maps host `6380` → Redis `6379` (**not** HTTP; BullMQ queue backend) |

The **worker** (`npm run worker -w @wfengine/server`) does **not** open an HTTP port; it connects to **Redis** and processes jobs.

### Browser / HTTP base URLs

| Service | Base URL |
|---------|----------|
| Studio UI | `http://localhost:5173/` |
| API | `http://localhost:30001/` |

### Direct API URLs (copy-paste templates)

Replace **`YOUR_WORKFLOW_ID`**, **`YOUR_VERSION_ID`**, and **`YOUR_EXECUTION_ID`** with real UUIDs from API responses or the database.

| Purpose | Method | Direct URL |
|---------|--------|------------|
| Liveness | GET | `http://localhost:30001/health` |
| List workflows | GET | `http://localhost:30001/workflows` |
| Create workflow | POST | `http://localhost:30001/workflows` |
| Get workflow + versions | GET | `http://localhost:30001/workflows/YOUR_WORKFLOW_ID` |
| Get one workflow version | GET | `http://localhost:30001/workflow-versions/YOUR_VERSION_ID` |
| Add version (`definition` JSON in body) | POST | `http://localhost:30001/workflows/YOUR_WORKFLOW_ID/versions` |
| Start execution | POST | `http://localhost:30001/executions` |
| Poll execution (see `result`, `initialData`) | GET | `http://localhost:30001/executions/YOUR_EXECUTION_ID` |
| Webhook trigger (body → workflow input) | POST | `http://localhost:30001/hooks/by-version/YOUR_VERSION_ID` |
| Optional async webhook | POST | `http://localhost:30001/hooks/by-version/YOUR_VERSION_ID?async=true` |
| Register cron for a version | POST | `http://localhost:30001/workflow-versions/YOUR_VERSION_ID/cron` |
| Remove cron | DELETE | `http://localhost:30001/workflow-versions/YOUR_VERSION_ID/cron` |

**PostgreSQL client URL** (Compose defaults):  
`postgresql://postgres:postgres@localhost:5433/wfengine`

**Redis client URL** (Compose defaults):  
`redis://localhost:6380`

---

## Technology stack — packages and versions

Versions below are **resolved installs** recorded in `package-lock.json` (your machine may resolve slightly newer patches if you run `npm install` again). **Ranges** in `package.json` use `^` unless noted.

### Runtime requirements

| Item | Version / note |
|------|----------------|
| **Node.js** | ≥ **18.18** (engines + Prisma; server `package.json`) |
| **npm** | **10.9.2** (`packageManager` in root `package.json`) |

### Infrastructure (Docker Compose)

| Service | Image / version |
|---------|-------------------|
| **PostgreSQL** | `postgres:16-alpine` (`infra/docker-compose.yml`), host port **5433** → container **5432** |
| **Redis** | `redis:7-alpine`, host port **6380** → **6379** |

### Monorepo tooling

| Package | Resolved version |
|---------|------------------|
| **turbo** | 2.9.6 |
| **typescript** | 5.9.3 |

### Workspace packages (internal)

| Package | Role | Declared |
|---------|------|----------|
| `@wfengine/shared` | Zod schemas, `parseWorkflow`, shared types | `^0.1.0` |
| `@wfengine/core` | `WorkflowEngine`, DAG execution | `^0.1.0` |
| `@wfengine/nodes-base` | Built-in triggers/actions | `^0.1.0` |
| `@wfengine/server` | API + Prisma + queues | `^0.1.0` |
| `@wfengine/ui` | React Flow canvas | `^0.1.0` |

### Server (`apps/server`)

| Dependency | Resolved |
|------------|----------|
| **fastify** | 5.8.5 |
| **@fastify/cors** | 10.1.0 |
| **@prisma/client** | 6.19.3 |
| **prisma** (dev) | 6.19.3 |
| **bullmq** | 5.76.2 |
| **ioredis** | 5.10.1 |
| **zod** | 3.25.76 |
| **node-cron** | 3.0.3 |
| **dotenv-cli** (dev) | (see lockfile; used to load repo-root `.env`) |
| **tsx** (dev) | 4.x |

### Studio (`apps/studio`)

| Dependency | Resolved |
|------------|----------|
| **react** / **react-dom** | 18.3.1 |
| **react-hook-form** / **@hookform/resolvers** / **zod** | Config panels matching `@wfengine/nodes-base/config-schemas` |
| **reactflow** | 11.11.4 |
| **@wfengine/ui** | `WorkflowCanvas`, `renderInspector`, imperative `exportWorkflowDefinition()` |
| **vite** | 6.4.2 (nested under `apps/studio` in lockfile) |
| **@vitejs/plugin-react** | ^4.3.4 |

**Persistence in the UI:** tab state and multi-draft storage live in [`apps/studio/src/App.tsx`](apps/studio/src/App.tsx) and [`apps/studio/src/studio-persistence.ts`](apps/studio/src/studio-persistence.ts). Server calls for publish/list use [`apps/studio/src/server-api.ts`](apps/studio/src/server-api.ts) (`GET /workflows`, `POST /workflows`, `POST /workflows/:id/versions`, `GET /workflow-versions/:versionId`).

Dev **`vite.config.ts`** can **proxy** `/runs` and `/health` to `http://localhost:30001` so **`VITE_WFENGINE_API=""`** uses relative **`/runs/inline`**. Otherwise set **`VITE_WFENGINE_API=http://localhost:30001`** (server enables CORS).

### Core / UI testing

| Dependency | Resolved |
|------------|----------|
| **vitest** | 2.1.9 |

### Other notable transitive deps

| Package | Resolved | Note |
|---------|----------|------|
| **zustand** | 4.5.7 | Used by React Flow state |

---

## Database structure (PostgreSQL + Prisma)

The ORM is **Prisma**; the schema lives in `apps/server/prisma/schema.prisma`. Physical table names use Prisma’s default **PascalCase** mapping (`Workflow`, not `workflows`).

### Entity relationship (conceptual)

```mermaid
erDiagram
  Workflow ||--o{ WorkflowVersion : "has many"
  WorkflowVersion ||--o{ Execution : "has many"

  Workflow {
    string id PK
    string name
    json meta
    datetime createdAt
    datetime updatedAt
  }

  WorkflowVersion {
    string id PK
    string workflowId FK
    int versionNumber
    json definitionJson
    string label
    string status
    datetime createdAt
  }

  Execution {
    string id PK
    string workflowVersionId FK
    string status
    json initialData
    json result
    string errorSummary
    json logs
    bool queued
    datetime startedAt
    datetime finishedAt
  }
```

### Tables (columns and meaning)

#### `Workflow`

| Column | Type | Meaning |
|--------|------|---------|
| `id` | UUID string (PK) | Stable id for this workflow “container”. |
| `name` | text | Human-readable name. |
| `meta` | JSON (nullable) | Extra metadata you choose (tags, owner, etc.). |
| `createdAt` / `updatedAt` | timestamp | Audit fields. |

#### `WorkflowVersion`

Each row is an **immutable snapshot** of the graph for a workflow.

| Column | Type | Meaning |
|--------|------|---------|
| `id` | UUID string (PK) | Used in URLs like `/hooks/by-version/:versionId`. |
| `workflowId` | FK → `Workflow.id` | Parent workflow. |
| `versionNumber` | int | Increments per workflow; **unique** together with `workflowId`. |
| `definitionJson` | JSON | Full workflow definition: `id`, `nodes[]`, `edges[]` (see `@wfengine/shared` schema). |
| `label` | text (nullable) | Optional label for this version. |
| `status` | text | Default `"published"` in schema. |
| `createdAt` | timestamp | When this version was created. |

#### `Execution`

One row per **run** of a specific workflow version.

| Column | Type | Meaning |
|--------|------|---------|
| `id` | UUID string (PK) | Execution id for `GET /executions/:id`. |
| `workflowVersionId` | FK → `WorkflowVersion.id` | Which graph version ran. |
| `status` | text | e.g. queued / running / completed / failed (exact values set by server code). |
| `initialData` | JSON (nullable) | Input payload (from API or webhook body). |
| `result` | JSON (nullable) | Final outputs / summary from the engine. |
| `errorSummary` | text (nullable) | Short error message if failed. |
| `logs` | JSON (nullable) | Structured logging from the run. |
| `queued` | boolean | Whether this run was handed off to the BullMQ worker. |
| `startedAt` / `finishedAt` | timestamp (nullable) | Timing. |

### Indexes and constraints

- **Unique:** `(workflowId, versionNumber)` on `WorkflowVersion`.
- **Indexes:** `workflowId` on `WorkflowVersion`; `workflowVersionId` on `Execution`.
- **Cascade:** Deleting a `Workflow` removes its versions; deleting a version removes related executions.

---

## Workflow JSON shape (what gets stored and exported)

Validated by Zod in `@wfengine/shared`:

- **`id`** — string, required.
- **`version`** — optional positive integer (definition metadata).
- **`nodes`** — array of `{ id, type, config? }` (at least one node).
- **`edges`** — array of `{ source, target }` (defaults to empty).

Built-in **node types** from `@wfengine/nodes-base` include:  
`trigger.webhook`, `trigger.cron`, `http.request`, `noop`, `email.send`, `email.read`, `slack.send`, `postgres.query`, `file.read`, `file.write`.  
Each exports Zod **`*ConfigSchema`** / **`*OutputSchema`** — see [`packages/nodes-base/README.md`](./packages/nodes-base/README.md) and source files for fields.

---

## How to use this project in the best way

### Local development (full stack)

1. Start infra: `docker compose -f infra/docker-compose.yml up -d`
2. Copy `.env.example` → `.env` at repo root (Postgres **5433**, Redis **6380**).
3. `npm install` && `npm run db:migrate -w @wfengine/server`
4. Terminal A: `npm run dev:server`
5. Terminal B: `npm run worker -w @wfengine/server` (required for **async** executions and **cron** ticks)
6. Terminal C: `npm run dev:studio` → open the URL Vite prints (typically port **5173**)

### Design → deploy workflow

1. **Prototype in Studio** — connect triggers to actions, use **Export JSON** to validate structure with `parseWorkflow` mentally or in code.
2. **Persist via API** — create a workflow, then POST versions with that `definition` JSON so the server can run and replay exact versions.
3. **Choose triggers** — webhooks for external systems; cron for schedules; manual `POST /executions` for testing or internal jobs.
4. **Protect production** — set `API_KEY` for protected routes; remember **webhooks** are intentionally outside that key (see README); use network rules or extend auth if exposed to the internet.
5. **Async vs sync** — use async + worker for long-running HTTP steps so the API does not block.
6. **Embed-only path** — if you do not need Postgres/Redis, depend only on `@wfengine/core`, `@wfengine/shared`, and `@wfengine/nodes-base`, register nodes, and call `engine.execute(definition, initialData)` from your app.

### Safety notes (from project README)

- **`http.request`** restricts URLs to **http/https**.
- No `eval` in core; treat user-defined code nodes as a future sandbox concern.

---

## Quick reference: main HTTP endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/workflows` | List workflow containers (latest version preview each) |
| POST | `/workflows` | Create workflow container |
| POST | `/workflows/:id/versions` | Add a new immutable version (`definition` JSON) |
| POST | `/executions` | Run a version (`workflowVersionId`, `initialData`, optional `async`) |
| GET | `/executions/:id` | Execution status / result |
| POST | `/hooks/by-version/:versionId` | Webhook: body → `initialData` |
| POST | `/workflow-versions/:versionId/cron` | Register cron expression |
| DELETE | `/workflow-versions/:versionId/cron` | Remove cron job |

---

## Where to read more in the repo

- Root **README.md** — commands, env vars, security notes.
- **packages/shared/src/workflow.schema.ts** — exact JSON schema.
- **apps/server/prisma/schema.prisma** — database models.
- **CONTRIBUTING.md** — Prisma migration workflow.

---

*Generated to document the wfengine workspace; dependency versions reflect `package-lock.json` in this repository.*
