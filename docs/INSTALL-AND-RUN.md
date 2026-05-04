# Install and run

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js** | ≥ 18.18 (see `engines` in server package) |
| **npm** | ≥ 9 (workspaces) |
| **PostgreSQL** + **Redis** | Only if you use `@wfengine/server` (Docker Compose recommended) |

---

## 1. Clone and install dependencies

```bash
git clone <repository-url> workflow-engine-sdk
cd workflow-engine-sdk
npm install
```

**What this does:** installs all workspace packages (`packages/*`, `apps/*`, `examples/*`) and links internal `@wfengine/*` dependencies.

---

## 2. Build all packages

```bash
npm run build
```

**What this does:** runs `turbo run build` — TypeScript `dist/` outputs for libraries and apps that declare a `build` script (depends on dependency order).

---

## 3. Engine-only demo (no database)

```bash
npm run example
```

**What this does:** runs `examples/programmatic` — uses **`@wfengine/core`** without Postgres/Redis.

---

## 4. Full stack: database, API, worker, Studio

### 4a. Start Postgres and Redis (Docker)

From repo root:

```bash
docker compose -f infra/docker-compose.yml up -d
```

**Default host ports (see `.env.example`):** Postgres **5433**, Redis **6380** (avoid clashes with local services).

### 4b. Environment file

```bash
cp .env.example .env
# Edit .env: DATABASE_URL, REDIS_URL, optional OPENAI_API_KEY, PORT, API_KEY
```

### 4c. Database migrations

```bash
npm run db:migrate -w @wfengine/server
```

**What this does:** Prisma `migrate deploy` using **`../../.env`** (repo root) via `dotenv-cli`.

**If Prisma client is out of date:**

```bash
npm run db:generate -w @wfengine/server
```

### 4d. Run API (terminal 1)

```bash
npm run dev:server
```

**Default:** HTTP **http://localhost:30001** (override with `PORT` in `.env`).

### 4e. Run worker (terminal 2)

Async executions and cron need a worker:

```bash
npm run worker -w @wfengine/server
```

### 4f. Run Studio (terminal 3)

```bash
npm run dev:studio
```

**Default:** **http://localhost:5173** (Vite).  
Optional: copy `apps/studio/.env.example` to `apps/studio/.env` for `VITE_WFENGINE_API` / `VITE_WFENGINE_API_KEY`.

---

## Common commands reference

| Command | Purpose |
|---------|---------|
| `npm install` | Install all workspaces |
| `npm run build` | Build entire monorepo via Turbo |
| `npm test` | Run tests (Turbo) |
| `npm run example` | Programmatic engine demo |
| `npm run dev:server` | Fastify API dev (`tsx watch`) |
| `npm run worker -w @wfengine/server` | BullMQ worker |
| `npm run dev:studio` | Vite Studio |
| `npm run db:migrate -w @wfengine/server` | Apply Prisma migrations |
| `npm run db:generate -w @wfengine/server` | Regenerate Prisma client |

---

## Production-style server start (after build)

```bash
npm run build
npm run start -w @wfengine/server
```

Run worker separately with the same `.env` as above.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `DATABASE_URL` not found | `.env` at **repo root** (server scripts load `../../.env`) |
| Studio cannot reach API | `PORT` / firewall; Studio proxy or `VITE_WFENGINE_API` |
| LLM nodes fail | `WFENGINE_OPENAI_API_KEY` or `OPENAI_API_KEY` in `.env` |
| Stale types after package changes | `npm run build -w @wfengine/shared` (and dependents) |

---

## Optional: Python bridge for agent nodes

When using `python_autogen` on a node, set **`PYTHONPATH`** to the folder containing your bridge package (see `.env.example` comments), with **Python 3** installed on the runner.
