# Deploying Studio, API server, and worker

You have **three deployable parts** and **two data services** they depend on:

| Part | What it is | Typical platform |
|------|------------|------------------|
| **Studio** | Static Vite app (`apps/studio`) | Vercel, Netlify, Cloudflare Pages |
| **API server** | Fastify HTTP (`apps/server` → `main.ts`) | Railway, Render, Fly.io, Docker host |
| **Worker** | BullMQ consumer (`apps/server` → `worker.ts`) | **Second** service on same platform as API |
| **PostgreSQL** | Prisma persistence | Managed DB (Railway, Neon, RDS, …) |
| **Redis** | BullMQ queue | Managed Redis (Upstash, Railway, ElastiCache, …) |

The worker **must** run for **async** executions and **cron**; the API can run **sync** inline runs without the queue, but anything queued still needs the worker.

---

## 1. Environment variables (production)

Set these for **server** and **worker** (same values on both):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis URL for BullMQ |
| `PORT` | HTTP port for API (often set by host, e.g. `30001` or platform default) |
| `API_KEY` | Optional; if set, clients send `x-api-key` (Studio uses `VITE_WFENGINE_API_KEY`) |
| `WFENGINE_OPENAI_API_KEY` / `OPENAI_API_KEY` | LLM nodes when using agents |

Run **migrations** against production DB once:

```bash
DATABASE_URL="postgresql://..." npm run db:migrate -w @wfengine/server
```

(Or use the host’s “release command” with the same env.)

**Studio (build-time for Vite):**

| Variable | Purpose |
|----------|---------|
| `VITE_WFENGINE_API` | **Public** base URL of your API, e.g. `https://api.example.com` (**no** trailing slash required; code strips it) |
| `VITE_WFENGINE_API_KEY` | Optional; must match server `API_KEY` |

**Important:** Empty `VITE_WFENGINE_API` only works in dev (same-origin + proxy). **Production Studio must set the real API URL.**

CORS: the server registers `@fastify/cors` with `origin: true`, so browser calls from your Vercel domain to the API are allowed.

---

## 2. Build commands (monorepo root)

From repository root (workspace installs link `@wfengine/*`):

```bash
npm install
npm run build
```

Artifacts:

- `@wfengine/server`: `apps/server/dist/` — run `node apps/server/dist/main.js` and `node apps/server/dist/worker.js` (or use package scripts from `apps/server` after `cd`).

Studio workspace package name is **`examples-studio`** (`apps/studio/package.json`):

```bash
npm run build -w examples-studio
```

Output: **`apps/studio/dist/`** (Vite default).

---

## 3. Studio → Vercel (example)

1. Connect the Git repo to Vercel.
2. **Root directory:** repository root (recommended for workspaces).
3. **Install command:** `npm install`
4. **Build command:** `npm run build -w examples-studio`
5. **Output directory:** `apps/studio/dist`
6. **Environment variables:** `VITE_WFENGINE_API`, optional `VITE_WFENGINE_API_KEY`.

If Vercel runs install from `apps/studio` only, workspace packages may not resolve; **building from root** with `-w examples-studio` is the reliable approach.

---

## 4. API + worker → same host pattern (Railway / Render / Fly)

Deploy **two services** from the **same** repo and **same** build:

| Service | Start command (after build) | Notes |
|---------|-----------------------------|--------|
| **API** | `npm run start -w @wfengine/server` or `node apps/server/dist/main.js` | Set `PORT` if the platform injects it |
| **Worker** | `npm run worker -w @wfengine/server` or `node apps/server/dist/worker.js` | No HTTP port; connects to Redis |

Both need identical `DATABASE_URL`, `REDIS_URL`, and optional `API_KEY`.

**Docker (optional):** there is no Dockerfile in-repo yet; you can add one that runs `npm ci`, `npm run build`, then two images or one image with different `CMD` per service.

---

## 5. End-to-end checklist

1. Create **Postgres** and **Redis** (managed or self-hosted).
2. Set `DATABASE_URL`, `REDIS_URL`, deploy **API**, run **migrations**.
3. Deploy **worker** with same env.
4. Deploy **Studio** with `VITE_WFENGINE_API=https://your-api-host`.
5. Open Studio URL → Run workflow → requests go to your API; async runs need **worker + Redis** healthy.

---

## 6. What not to expect

- **Vercel Serverless** is a poor fit for the **long-lived** Fastify + **BullMQ worker** process unless you redesign to queues elsewhere.
- **One Vercel project** should be **Studio only**; put API + worker on a **container/PaaS** that supports always-on Node processes.
