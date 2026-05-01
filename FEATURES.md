# Current features (wfengine)

This document describes **what exists today** in this repository: the **Studio** app (`apps/studio`), the **`@wfengine/ui`** canvas library, and the **optional server stack** (`apps/server`). It is meant for onboarding (“what can I do so far?”).

---

## Big picture — what you can do end-to-end

| Area | What works today |
|------|------------------|
| **Studio (browser)** | Build a **visual graph** (palette items are **draggable** or clickable), structured **forms** for built-in nodes (Zod-aligned with `@wfengine/nodes-base`), **Undo/Redo**, **multiple workflow tabs** (**+ New** opens an **empty** canvas), **Export** (downloads JSON), **Import** (paste or file → **new** tab), **Save** (multiple **local drafts** in **localStorage**), **Library** (browse local drafts + server workflows), **Publish** (save an immutable version to Postgres via the REST API when the server is up), and **Run workflow** via **`POST /runs/inline`** (`VITE_WFENGINE_API` / optional **`VITE_WFENGINE_API_KEY`**). |
| **Engine (Node.js library)** | Run that JSON with **`WorkflowEngine`** — topological execution, retries, built-in nodes — **without** a database. |
| **Server (optional)** | **Persist** workflows in Postgres, **list** workflows (**`GET /workflows`**), **run** executions via REST, **webhooks**, **cron** (Redis + worker), **Swagger UI** at `/api-docs`. |

---

## wfengine Studio — what you see on the screen

The Studio app uses a **top bar** (brand, **workflow tabs** + **+ New**, toolbar actions), **`WorkflowCanvas`** from `@wfengine/ui` with **`renderInspector`** driving **`NodeConfigPanel`** (react-hook-form + Zod). **Run** opens a modal with JSON results/errors (**Sonner** toasts). Workflow-level fields (**Workflow ID**, description, **initial data JSON**) live in the **Inspector** when no node is selected.

Palette definitions live in [`apps/studio/src/palette-data.ts`](apps/studio/src/palette-data.ts) (`STUDIO_PALETTE`).

### Top bar

| Control | What it does |
|---------|----------------|
| **Tabs** | Each tab is an isolated workflow (nodes, edges, inspector text). Switch tabs to edit another graph; **×** closes a tab (multiple tabs only). |
| **+ New** | Opens a **new** tab with an **empty** canvas and a fresh **`untitled-…`** workflow id. |
| **Undo / Redo** | Graph history (same as keyboard shortcuts where enabled). |
| **Export** | Downloads **`{workflowId}.json`** — a **`WorkflowDefinition`** (`id`, `nodes`, `edges`, optional `version`). |
| **Save** | Persists the **active** tab as a **local draft** (multiple drafts; see [`studio-persistence.ts`](apps/studio/src/studio-persistence.ts)). Survives refresh on **this browser profile**. |
| **Library** | Modal: **Local drafts** (open in new tab, delete) and **Server workflows** (after **Publish** — open latest version in a new tab). |
| **Publish** | **`POST /workflows`** then **`POST /workflows/:id/versions`** with the current exported definition (needs API + DB). |
| **Import** | Paste JSON or choose a file; validates with **`parseWorkflow`** and opens in a **new** tab. |
| **Run** | **`POST /runs/inline`** with exported definition + optional initial data from the inspector. |

### Left sidebar — “Node Library”

Search + categorized rows (**Triggers**, **Actions**, **Data**). Each row is **draggable** onto the canvas **or** clickable to add a node.

| Palette label | Engine `type` |
|---------------|----------------|
| Webhook | `trigger.webhook` |
| Cron | `trigger.cron` |
| HTTP Request | `http.request` |
| Pass-through | `noop` |
| Send Email | `email.send` |
| Read Email (IMAP) | `email.read` |
| Send Slack | `slack.send` |
| Postgres Query | `postgres.query` |
| Read File / Write File | `file.read`, `file.write` |

**Built-in node types** in `@wfengine/nodes-base` (registered on the server via `registerBuiltinNodes`):  
`noop`, `http.request`, `trigger.webhook`, `trigger.cron`, `email.send`, `email.read`, `slack.send`, `postgres.query`, `file.read`, `file.write`.  
**Config** shapes live in **`@wfengine/nodes-base/config-schemas`**; Studio uses typed panels where available, plus JSON fallback for unknown types.

### Middle — canvas (React Flow)

| Interaction | What it does |
|-------------|----------------|
| **Drag a node** | Move it. |
| **Connect handles** | Directed edge = execution order **source → target**. |
| **Click node / empty pane** | Select node or clear selection. |

**Canvas widgets:**

| Control | Typical behavior |
|---------|------------------|
| **Zoom / Fit** | Bottom-right **Controls** cluster. |
| **Overview** | Collapsible **mini map** (labeled “Overview”) — pan/zoom the full graph when expanded. |
| **Dots background** | Visual only. |

### Right sidebar — Inspector

| Mode | Content |
|------|---------|
| **No node selected** | **Workflow inspector**: Workflow ID (`definition.id`), description, **Initial data (JSON)** for runs. |
| **Node selected** | **`NodeConfigPanel`**: structured fields per node type (secrets, partial merge into config while typing where implemented). |

---

## Export / Import / Save / Publish

| Action | Result |
|--------|--------|
| **Export** | File download of **`WorkflowDefinition`** JSON for the **active** tab. |
| **Import** | New tab with graph loaded from JSON (**positions** from export if present; pure definitions still lay out on a grid). |
| **Save** | Stores the active tab under **`wfengine.studio.workspaces.v1`** + per-workspace keys — multiple named drafts; migration from the legacy single-key snapshot on first load. |
| **Publish** | Server-side **workflow row** + **version row** (`definitionJson`). Reopen via **Library → Server workflows → Open latest**. |

Inline execution (**Run**) does **not** require saving or publishing; it only needs **`POST /runs/inline`** reachable.

---

## Delete / Undo

- **Delete / Backspace** removes selected nodes or edges (React Flow defaults).
- **Undo / Redo** restores graph snapshots from the canvas history.

---

## Beyond the Studio — server & API (summary)

With Docker Compose, migrations, **`npm run dev:server`**, and optionally **`npm run worker -w @wfengine/server`**:

- **REST**: workflows (**`GET /workflows`**, **`POST /workflows`**, **`GET /workflows/:id`**, **`POST /workflows/:id/versions`**), versions (**`GET /workflow-versions/:versionId`**), executions, hooks, cron.
- **Swagger**: `GET /api-docs`.

See **README.md** and **PROJECT-GUIDE.md** for ports, env vars, and URL tables.

---

## What is *not* here yet (common expectations)

- No **user accounts**, **login UI**, or **multi-tenant** isolation in Studio.
- No **hosted Studio** asset pipeline beyond what you deploy yourself.
- No **syntax-highlighted** JSON editor in every inspector field (some fields are plain textareas).
- **Custom node types** require adding palette entries + registering **`NodeDefinition`** implementations (or using JSON fallback only where allowed).

---

*Aligned with the current `apps/studio` + `apps/server` behavior; adjust this file when you add UI or API surface area.*
