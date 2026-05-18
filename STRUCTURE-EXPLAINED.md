# Project Structure Explained

## Overview

This is a **monorepo** containing libraries, deployable applications, and examples.

---

## Directory Structure

```
workflow-engine-sdk/
│
├── packages/              ← Shared Libraries (NOT deployable)
│   ├── shared/           ← Types, schemas, validation
│   ├── core/             ← Workflow engine logic
│   ├── nodes-base/       ← Built-in workflow nodes
│   ├── nodes-agents/     ← AI agent nodes
│   └── ui/               ← React components for Studio
│
├── apps/                  ← Deployable Applications
│   ├── server/           ← Backend API + Worker
│   │   ├── src/
│   │   │   ├── main.ts   ← Entry: API Server (HTTP)
│   │   │   ├── worker.ts ← Entry: Background Worker
│   │   │   ├── app.ts    ← Fastify app setup
│   │   │   ├── routes/   ← API endpoints
│   │   │   └── prisma/   ← Database schema
│   │   └── package.json  ← @wfengine/server
│   │
│   └── studio/           ← Frontend UI (React + Vite)
│       └── package.json  ← examples-studio
│
└── examples/              ← Example Code (NOT deployable)
    ├── programmatic/     ← Demo: Use engine in code
    ├── workflows/        ← Sample workflow JSON files
    └── python-autogen-bridge/ ← Python integration example
```

---

## What Gets Deployed?

### ✅ Deployable (apps/)

| Service | Location | Entry Point | Purpose |
|---------|----------|-------------|---------|
| **API Server** | `apps/server` | `src/main.ts` | REST API, webhooks, sync execution |
| **Worker** | `apps/server` | `src/worker.ts` | Background jobs, async execution, cron |
| **Studio** | `apps/studio` | Vite app | Visual workflow builder UI |

### ❌ NOT Deployable

| Type | Location | Purpose |
|------|----------|---------|
| **Libraries** | `packages/*` | Imported by apps, not standalone |
| **Examples** | `examples/*` | Demos and tutorials |

---

## Understanding apps/server

**One package, two entry points:**

```
apps/server/
├── src/
│   ├── main.ts          ← Starts Fastify HTTP server
│   ├── worker.ts        ← Starts BullMQ worker
│   ├── app.ts           ← Shared: Fastify app builder
│   ├── engine-factory.ts ← Shared: Engine setup
│   ├── prisma.ts        ← Shared: Database client
│   └── queue.ts         ← Shared: Redis queue
└── package.json         ← ONE package
```

**Both share:**
- Same dependencies
- Same database connection
- Same workflow engine
- Same node registry

**Different responsibilities:**

| main.ts (API) | worker.ts (Worker) |
|---------------|-------------------|
| HTTP endpoints | Background jobs |
| Sync execution | Async execution |
| Webhooks | Cron schedules |
| Port 3001 | No port |

---

## Understanding examples/programmatic

**What it is:**
- A demo script showing how to use the engine **without** the API server
- Runs once and exits
- For learning and testing

**What it does:**

```typescript
// Import engine
import { WorkflowEngine } from "@wfengine/core";

// Create and configure
const engine = new WorkflowEngine();
registerBuiltinNodes(engine);

// Define workflow in code
const workflow = { nodes: [...], edges: [...] };

// Execute directly
const result = await engine.execute(workflow, data);
```

**Use cases:**
- ✅ Learning how the engine works
- ✅ Testing workflows locally
- ✅ Embedding in your own Node.js app
- ✅ Quick prototyping
- ❌ NOT for production deployment

**How to run:**

```bash
npm run example
# Runs once, prints result, exits
```

---

## Why Railway Auto-Detected 3 Services

Railway scans for `package.json` files with `start` or `build` scripts:

```
Found: apps/server/package.json
  → Created: @wfengine/server service ✅ Correct

Found: apps/studio/package.json  
  → Created: examples-studio service ✅ Correct

Found: examples/programmatic/package.json
  → Created: examples-programmatic service ❌ Wrong! (just a demo)
```

**Railway doesn't know:**
- `apps/` = deployable applications
- `examples/` = demo code

---

## How We Fixed It

### 1. Created `.railwayignore`

Tells Railway to ignore examples and packages:

```
examples/
packages/
```

### 2. Renamed Script

Changed `examples/programmatic/package.json`:

```json
// Before (Railway detects as service)
"scripts": {
  "start": "tsx src/run.ts"
}

// After (Railway ignores)
"scripts": {
  "demo": "tsx src/run.ts"
}
```

Railway looks for `start` script. By renaming to `demo`, it won't auto-detect.

---

## Deployment Configurations

### Option 1: Minimal (2 services)

**Deploy:**
- PostgreSQL (Railway template)
- API Server only (`apps/server/main.ts`)

**Cost:** ~$10-20/month

**Features:**
- ✅ REST API
- ✅ Sync execution
- ❌ No async jobs
- ❌ No cron schedules

**Railway Setup:**
```bash
Build: npm ci && npm run build
Start: npm run start -w @wfengine/server
```

---

### Option 2: Combined (3 services) ⭐ Recommended

**Deploy:**
- PostgreSQL (Railway template)
- Redis (Railway template)
- API + Worker combined (`apps/server`)

**Cost:** ~$15-30/month

**Features:**
- ✅ REST API
- ✅ Sync execution
- ✅ Async jobs
- ✅ Cron schedules
- ✅ All features

**Railway Setup:**
```bash
Build: npm ci && npm run build
Start: npm run start:combined -w @wfengine/server
```

**Note:** Requires creating `apps/server/src/combined.ts` (see MINIMAL-DEPLOYMENT.md)

---

### Option 3: Separate (4 services)

**Deploy:**
- PostgreSQL (Railway template)
- Redis (Railway template)
- API Server (`apps/server/main.ts`)
- Worker (`apps/server/worker.ts`)

**Cost:** ~$20-40/month

**Features:**
- ✅ All features
- ✅ Independent scaling
- ✅ Better for high traffic

**Railway Setup:**

**API Service:**
```bash
Build: npm ci && npm run build
Start: npm run start -w @wfengine/server
```

**Worker Service:**
```bash
Build: npm ci && npm run build
Start: npm run start:worker -w @wfengine/server
```

---

### Option 4: Full Stack (5 services)

**Deploy:**
- PostgreSQL
- Redis
- API Server
- Worker
- Studio

**Cost:** ~$25-50/month

**Features:**
- ✅ Everything
- ✅ Visual workflow builder

---

## Package Dependencies

```
┌─────────────┐
│   shared    │ ← Base types and schemas
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    core     │ ← Workflow engine
└──────┬──────┘
       │
       ├──────────────┐
       ▼              ▼
┌─────────────┐  ┌─────────────┐
│ nodes-base  │  │ nodes-agents│ ← Node implementations
└──────┬──────┘  └──────┬──────┘
       │                │
       └────────┬───────┘
                ▼
         ┌─────────────┐
         │   server    │ ← API + Worker
         └─────────────┘

         ┌─────────────┐
         │     ui      │ ← React components
         └──────┬──────┘
                ▼
         ┌─────────────┐
         │   studio    │ ← Visual editor
         └─────────────┘
```

---

## Build Order (Turborepo)

Turborepo automatically builds in correct order:

```
1. shared     (no dependencies)
2. core       (depends on shared)
3. nodes-base (depends on core, shared)
4. nodes-agents (depends on core, shared)
5. ui         (depends on shared)
6. server     (depends on core, shared, nodes-base, nodes-agents)
7. studio     (depends on ui, shared)
```

**Command:** `npm run build` (at root)

---

## Common Commands

### Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run API server
npm run dev:server

# Run worker
npm run worker -w @wfengine/server

# Run studio
npm run dev:studio

# Run programmatic example
npm run example
```

### Production

```bash
# Build for production
npm ci && npm run build

# Start API server
npm run start -w @wfengine/server

# Start worker
npm run start:worker -w @wfengine/server

# Start combined (API + Worker)
npm run start:combined -w @wfengine/server
```

---

## Summary

| Component | Type | Deploy? | Purpose |
|-----------|------|---------|---------|
| `packages/shared` | Library | ❌ | Types & schemas |
| `packages/core` | Library | ❌ | Workflow engine |
| `packages/nodes-base` | Library | ❌ | Built-in nodes |
| `packages/nodes-agents` | Library | ❌ | AI agent nodes |
| `packages/ui` | Library | ❌ | React components |
| `apps/server` | App | ✅ | API + Worker |
| `apps/studio` | App | ✅ | Visual editor |
| `examples/programmatic` | Demo | ❌ | Code example |
| `examples/workflows` | Data | ❌ | JSON samples |

**Key Takeaway:**
- Only deploy from `apps/`
- Everything else is either a library or example
- `apps/server` contains both API and Worker code
- Railway should only detect 2 services: server and studio

---

## Next Steps

1. ✅ Commit the fixes:
   ```bash
   git add .railwayignore examples/programmatic/package.json package.json
   git commit -m "Fix Railway auto-detection"
   git push
   ```

2. ✅ Delete auto-detected services in Railway

3. ✅ Manually create services:
   - Add PostgreSQL
   - Add Redis (if using worker)
   - Add API Server (or combined)
   - Optionally add Studio

4. ✅ Configure with proper build/start commands

5. ✅ Deploy and test

---

## Questions?

- **"Why is worker in apps/server?"** → They share code, easier to maintain
- **"Can I separate them?"** → Yes, but not necessary for most cases
- **"Should I deploy examples?"** → No, they're just demos
- **"What about packages?"** → Never deploy, they're libraries
- **"Why did Railway detect 3?"** → It found package.json files with start scripts

For more details, see:
- `HOW-TO-RUN.md` - Local development
- `RAILWAY-DEPLOYMENT.md` - Full Railway guide
- `RAILWAY-FIX.md` - Fixing deployment issues
- `MINIMAL-DEPLOYMENT.md` - Cost optimization
