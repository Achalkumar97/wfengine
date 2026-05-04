# wfengine — Workflow Engine SDK

Developer-first workflow automation libraries: run **JSON DAG workflows** in Node.js with a plugin-style **node registry**, optional **REST + Postgres + BullMQ** execution service, and optional **React Flow** visual builder.

**Extended docs:** [docs/README.md](./docs/README.md) (full stack, architecture diagrams, file tree, install/run).

## Repository layout

| Area | Path |
|------|------|
| **Runnable apps** | [`apps/server`](./apps/server) (Fastify API), [`apps/studio`](./apps/studio) (Vite UI) |
| **Shared libraries** | [`packages/*`](./packages) — `@wfengine/shared`, `@wfengine/core`, `@wfengine/nodes-base`, `@wfengine/ui` |
| **Small samples** | [`examples/programmatic`](./examples/programmatic) — engine-only script; [`examples/workflows`](./examples/workflows) — importable workflow JSON |

## Packages

| Package | Description |
|--------|-------------|
| [@wfengine/shared](./packages/shared/README.md) | Zod schemas + types (`parseWorkflow`, API payloads). |
| [@wfengine/core](./packages/core/README.md) | **`WorkflowEngine`**, DAG execution, retries, logging (no DB/UI). |
| [@wfengine/nodes-base](./packages/nodes-base/README.md) | Built-ins: triggers + `http.request`, `email.send` / `email.read`, `slack.send`, `postgres.query`, `file.read` / `file.write`, `noop`. |
| [@wfengine/server](./apps/server/README.md) | Fastify API, Prisma + PostgreSQL, BullMQ workers, webhooks, repeatable cron jobs. |
| [@wfengine/ui](./packages/ui/README.md) | React Flow canvas + export to workflow JSON. |

Install only what you need (tree-shakable): **`@wfengine/core`** (+ **`@wfengine/shared`**) for embedded execution; add **`@wfengine/nodes-base`** only if you want built-in integrations, or **import individual node definitions** and call `engine.registerNode(...)` without registering the full set.

### Modular install (pick packages on npm)

| Goal | Typical dependencies |
|------|----------------------|
| Engine + validation only | `@wfengine/core`, `@wfengine/shared` |
| + all built-in nodes | add `@wfengine/nodes-base` (pulls SMTP/IMAP/Slack/pg deps — see [nodes-base README](./packages/nodes-base/README.md)) |
| Only email in / out | `@wfengine/core`, `@wfengine/shared`, `@wfengine/nodes-base` — register **`emailReadNode`** and **`emailSendNode`** only (see example below) |
| Hosted runs + DB | add `@wfengine/server` stack (Postgres, Redis) |

**Reading / sending email only (no server, no UI):**

```typescript
import { WorkflowEngine } from "@wfengine/core";
import { emailReadNode, emailSendNode } from "@wfengine/nodes-base";

const engine = new WorkflowEngine();
engine.registerNode(emailReadNode);
engine.registerNode(emailSendNode);

await engine.execute(
  {
    id: "mail-flow",
    nodes: [
      {
        id: "read",
        type: "email.read",
        config: {
          host: "imap.gmail.com",
          port: 993,
          secure: true,
          user: process.env.GMAIL_USER!,
          password: process.env.GMAIL_APP_PASSWORD!,
          mailbox: "INBOX",
          maxMessages: 3,
          unseenOnly: true,
        },
      },
      {
        id: "send",
        type: "email.send",
        config: {
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          authUser: process.env.GMAIL_USER!,
          authPass: process.env.GMAIL_APP_PASSWORD!,
          from: process.env.GMAIL_USER!,
          to: "you@example.com",
          subject: "Summary",
          text: "Built from wfengine — replace with templating from prior node outputs.",
        },
      },
    ],
    edges: [{ source: "read", target: "send" }],
  },
  {},
);
```

See [`packages/nodes-base/README.md`](./packages/nodes-base/README.md) for Zod schemas (`*ConfigSchema`) per node.

## Prerequisites

- Node.js **≥ 18**
- npm **≥ 9** (workspaces)

For the server: **PostgreSQL**, **Redis**, and migrated schema.

## Quick start (engine only)

```bash
npm install
npm run build
npm run example
```

This runs [`examples/programmatic`](./examples/programmatic) — a webhook trigger → HTTP GET workflow hitting `httpbin.org`.

### Programmatic usage

```typescript
import { WorkflowEngine } from "@wfengine/core";
import { registerBuiltinNodes } from "@wfengine/nodes-base";

const engine = new WorkflowEngine();
registerBuiltinNodes(engine);

const result = await engine.execute(
  {
    id: "my-workflow",
    nodes: [
      { id: "a", type: "noop", config: {} },
      { id: "b", type: "noop", config: {} },
    ],
    edges: [{ source: "a", target: "b" }],
  },
  { hello: "world" },
);

console.log(result.outputs);
```

### Workflow JSON shape

Nodes run in **topological order**. **Entry nodes** merge `initialData`; downstream nodes shallow-merge upstream **object** outputs (non-objects are keyed by parent node id).

See [`packages/shared/src/workflow.schema.ts`](./packages/shared/src/workflow.schema.ts).

### Generate unit tests from GitHub (recommended pipeline)

**Goal:** pick important source files from any repo, generate idiomatic unit tests with an LLM, then save them under a local folder for review or CI.

**Steps**

1. **`github.repo.analyze`** — Recommended **before** **`github.files.read`** when using **`smartSelectMode: "core"`** or **`"all"`**. It populates **`sourceFiles`** for smart selection and helps the LLM when **`package.json`** / tree metadata matter.
2. **`github.files.read`** — Fetches file contents via the GitHub API. Set **`owner`**, **`repo`**, **`ref`**, and **`githubToken`** (private repos). Either:
   - **`smartSelectMode: "custom"`** — set **`targetFiles`** to repo-relative paths you care about, or
   - **`smartSelectMode: "core"`** or **`"all"`** — use merged **`sourceFiles`** from analyze; **`core`** prefers paths under `src/`, `lib/`, `services/`, `utils/`, `engines/`, etc.; **`all`** takes application-like source paths up to **`smartMaxFiles`**.
3. **`llm.generate-unit-tests`** — Merged **`files`** in → **`generatedTestFiles`** out. Set **`preferredTestStyle`** (`auto` uses **`package.json`**, **`go.mod`**, **`pom.xml`**, **`pyproject.toml`** when those files appear in the bundle) and OpenAI-compatible credentials (**`OPENAI_API_KEY`**, **`OPENAI_BASE_URL`** on the runner, or node config).
4. **`code.write-test-files`** — Writes tests under **`baseDirectory`** (e.g. `./generated-tests`) with path traversal protection.

**Recommended usage for best results**

- Start with **`smartSelectMode: "core"`** and **`smartMaxFiles`** between **10 and 15** so the model stays focused on high-signal application code (pair with **`github.repo.analyze`** and **`focus: "source"`** when possible).
- Optionally include **`package.json`** / **`pyproject.toml`** in the fetched set (or rely on analyze + **`includePackageJson`**) so **`preferredTestStyle: "auto"`** can align with Jest, Vitest, pytest, etc.
- Switch to **`custom`** + explicit **`targetFiles`** when you already know the exact modules to cover.

**Choosing good `targetFiles`**

- Prefer **units with real logic**: domain services, parsers, utilities, pure functions — not thin config-only files unless that is what you need to lock down.
- Cover **one language/stack per batch** when possible, or keep batches small so the model stays focused.
- Use paths that **exist on `ref`**; verify in the GitHub UI or clone locally first.
- Avoid huge generated/vendor trees; the read node already skips obvious **`node_modules`** / **`dist`** patterns when using smart modes.

**Output: `language` and `framework`**

Each entry in **`generatedTestFiles`** includes:

- **`language`** — syntactic language of the **test file** (e.g. `python`, `typescript`, `go`).
- **`framework`** — stack reflected in the test code (e.g. `pytest`, `jest`, `go test`, `JUnit 5`). Use these fields to route files to the right runners or for reporting.

**Running generated tests locally** (after `code.write-test-files`)

| Context | Typical command (from repo or `./generated-tests` as appropriate) |
|--------|----------------------------------------------------------------------|
| Node / TS | `npm test`, `npx vitest`, or `npx jest` (match the repo’s `package.json`). |
| Python | `pytest` or `python -m pytest` from the package root / `PYTHONPATH`. |
| Go | `go test ./...` from the module root. |
| Java | `mvn test` or `./gradlew test`. |
| Rust | `cargo test`. |

Copy or merge generated files into the **real** project test tree when satisfied; the example uses **`./generated-tests`** so nothing overwrites your repo until you choose.

Example workflow (with inline `_wfengine_help` for customization notes): [`examples/workflows/generate-unit-tests-from-github.json`](./examples/workflows/generate-unit-tests-from-github.json).

### Custom node

```typescript
import { z } from "zod";
import type { NodeDefinition } from "@wfengine/core";

const ConfigSchema = z.object({ greeting: z.string() });

export const helloNode: NodeDefinition = {
  type: "demo.hello",
  label: "Hello",
  category: "action",
  configSchema: ConfigSchema as unknown as import("zod").ZodType<Record<string, unknown>>,
  execute: async ({ config, inputData }) => {
    const c = ConfigSchema.parse(config);
    return {
      ...inputData,
      greeting: `${c.greeting}!`,
    };
  },
};

engine.registerNode(helloNode);
```

## Execution service (`@wfengine/server`)

### Local infra

Compose publishes Postgres on **host port 5433** so it does not clash with a system PostgreSQL on `:5432`.

```bash
docker compose -f infra/docker-compose.yml up -d
cp .env.example .env   # repo root — default URLs use Postgres :5433 and Redis :6380 with compose
npm install
npm run db:migrate -w @wfengine/server
```

Prisma runs inside `apps/server`; scripts load **`../../.env`** (repo root) via **`dotenv-cli`**. If you see `Environment variable not found: DATABASE_URL`, ensure `.env` exists at the repo root or export it yourself:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/wfengine"
npm run db:migrate -w @wfengine/server
```

### Run API + worker

Terminal 1:

```bash
npm run dev:server
```

Terminal 2:

```bash
npm run worker -w @wfengine/server
```

Environment variables:

| Variable | Purpose |
|---------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis for BullMQ |
| `PORT` | HTTP port (default `30001`) |
| `API_KEY` | If set, requires `x-api-key` on routes **except** `/health`, `/hooks/*`, and `/api-docs` |

### HTTP highlights

- `GET /api-docs` — Swagger UI (OpenAPI); raw spec at `/api-docs/json`  
- `GET /workflows` — list workflow containers (includes latest version preview per workflow)  
- `POST /workflows` — create workflow container  
- `POST /workflows/:id/versions` — append immutable version (`definition` JSON)  
- `POST /executions` — run (`workflowVersionId`, `initialData`, optional `async: true`)  
- `GET /executions/:id`  
- `POST /hooks/by-version/:versionId` — webhook body → `initialData`  
- `POST /workflow-versions/:versionId/cron` — register BullMQ repeatable job (`{ "expression": "0 * * * *" }`)  
- `DELETE /workflow-versions/:versionId/cron` — remove repeatable job (best-effort)

## Visual studio (`apps/studio`)

```bash
npm run dev:studio
```

Dark-mode **workflow editor**: resizable library / canvas / inspector, searchable categorized palette with drag-and-drop, gradient node cards + node toolbar (edit / duplicate / delete), **Undo/Redo**, copy/paste of subgraphs, Dagre auto-layout, **Export/Import JSON**, **Run workflow** (`POST /runs/inline`) with modal results and Sonner toasts. **Tailwind CSS v4** scans `apps/studio` + `packages/ui/src` — extend or theme via [`apps/studio/src/index.css`](apps/studio/src/index.css).

### Tabs, saving, and Library

- **Tabs** — Work on multiple workflows in one browser window: **+ New** opens an **empty** canvas (each tab has its own graph and inspector fields). Switch tabs to edit another workflow; close a tab with the × control.
- **Save** — Writes the **active** workflow to **browser localStorage** as a named **local draft** (multiple drafts supported; see [`apps/studio/src/studio-persistence.ts`](apps/studio/src/studio-persistence.ts)). Survives refresh on **this browser profile** only.
- **Library** — Opens a modal to **browse local drafts** (open in a new tab, delete) and **server workflows** (after you publish — see below).
- **Publish** — With the API reachable, creates or updates a server workflow: **`POST /workflows`** then **`POST /workflows/:id/versions`** with the current exported definition stored in PostgreSQL. Use **Library → Server workflows → Open latest** to load a published version into a new tab after you leave and return (same API URL and optional API key).

**Import** always applies JSON into a **new** tab so you do not overwrite another workflow by mistake.

With API + env: copy [`apps/studio/.env.example`](apps/studio/.env.example); leave `VITE_WFENGINE_API` empty to use the Vite proxy to `localhost:30001`, or set the URL explicitly. Set **`VITE_WFENGINE_API_KEY`** when the server uses **`API_KEY`**. **`Test Node`** per step is left for a follow-up hook into `engine.execute` slices.

## Scripts (repo root)

| Script | Description |
|--------|-------------|
| `npm run build` | Turborepo build all packages |
| `npm test` | Vitest (core + ui) |
| `npm run example` | Programmatic demo |
| `npm run db:migrate` | Prisma migrate deploy (server) |
| `npm run dev:server` | Fastify dev server |
| `npm run dev:studio` | Vite studio app |

## Security notes

- **`http.request`** blocks non-http(s) URLs.  
- **No `eval`** in core; user “function” nodes belong in an isolated sandbox (future).  
- Webhook routes are **public** when `API_KEY` is set (they bypass the API key middleware); protect with network rules or extend auth.

## License

MIT
