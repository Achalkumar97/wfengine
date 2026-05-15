# Minimal Deployment Guide

This guide shows how to reduce the number of services for cost-effective deployment.

## Service Reduction Options

### Current Setup (5 services)
- PostgreSQL
- Redis
- API Server
- Worker
- Studio

**Cost:** ~$25-50/month

---

## Option 1: API Server Only (2 services) ⭐ Cheapest

**Services:**
- PostgreSQL
- API Server (sync execution only)

**Remove:**
- Redis
- Worker
- Studio

### What Works:
✅ REST API endpoints  
✅ Synchronous workflow execution  
✅ Workflow CRUD operations  
✅ Webhook triggers (sync)  

### What Doesn't Work:
❌ Async execution (`async: true`)  
❌ Scheduled/cron jobs  
❌ Background job processing  
❌ Visual workflow builder  

### Setup:

No code changes needed! Just don't start the worker and don't use async features.

**Railway Deployment:**
1. Add PostgreSQL
2. Deploy API Server only
3. Don't deploy Worker service

**Cost:** ~$10-20/month

---

## Option 2: Combined API + Worker (3 services) ⭐ Recommended

**Services:**
- PostgreSQL
- Redis
- API Server + Worker (combined in one process)

**Remove:**
- Studio (optional - can add later)

### What Works:
✅ Everything (full functionality)  
✅ Async execution  
✅ Scheduled jobs  
✅ Background processing  

### What Doesn't Work:
❌ Visual workflow builder (use JSON workflows)

### Setup:

Create a new combined entry point:

**File:** `apps/server/src/combined.ts`

```typescript
/**
 * Combined API + Worker process
 * Runs both the Fastify server and BullMQ worker in one Node.js process
 */
import { Worker } from "bullmq";
import { loadEnv } from "./env.js";
import { prisma } from "./prisma.js";
import { createServerEngine } from "./engine-factory.js";
import { createQueue } from "./queue.js";
import { buildApp } from "./app.js";
import {
  executeExecutionRecord,
  executeSync,
} from "./run-workflow.js";
import { QUEUE_NAME, type JobPayload } from "./queue.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const engine = createServerEngine();
  const queue = createQueue(env.REDIS_URL);

  // Start API Server
  const app = await buildApp({
    prisma,
    engine,
    queue,
    apiKey: env.API_KEY,
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`API Server listening on port ${env.PORT}`);

  // Start Worker in the same process
  const worker = new Worker<JobPayload>(
    QUEUE_NAME,
    async (job) => {
      const data = job.data;
      if (data.type === "execute") {
        await executeExecutionRecord(prisma, engine, data.executionId);
        return;
      }
      if (data.type === "cronTick") {
        await executeSync(prisma, engine, data.workflowVersionId, {
          cron: true,
          firedAt: new Date().toISOString(),
        });
      }
    },
    { connection: { url: env.REDIS_URL }, concurrency: 5 },
  );

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed`, err);
  });

  console.log(`Worker listening on queue ${QUEUE_NAME}`);

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down gracefully...");
    await worker.close();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

**Update `apps/server/package.json`:**

```json
{
  "scripts": {
    "dev": "dotenv -e ../../.env -- tsx watch src/main.ts",
    "dev:combined": "dotenv -e ../../.env -- tsx watch src/combined.ts",
    "build": "dotenv -e ../../.env -- prisma generate && tsc",
    "start": "node dist/main.js",
    "start:combined": "node dist/combined.js"
  }
}
```

**Railway Deployment:**
1. Add PostgreSQL
2. Add Redis
3. Deploy one service with start command: `npm run start:combined -w @wfengine/server`

**Cost:** ~$15-30/month

---

## Option 3: SQLite Instead of PostgreSQL (Reduces 1 service)

**Services:**
- API Server + Worker (with SQLite)
- Redis

**Remove:**
- PostgreSQL (use SQLite file instead)
- Studio (optional)

### What Works:
✅ All features work  
✅ Simpler setup  
✅ Lower cost  

### What Doesn't Work:
⚠️ Not recommended for production  
⚠️ Limited concurrent writes  
⚠️ No database replication  

### Setup:

**1. Update Prisma Schema**

Edit `apps/server/prisma/schema.prisma`:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

// Rest of schema stays the same
```

**2. Update `.env`:**

```env
DATABASE_URL="file:./dev.db"
REDIS_URL="redis://localhost:6380"
PORT=3001
```

**3. Regenerate Prisma Client:**

```bash
npm run db:generate -w @wfengine/server
```

**4. Create New Migration:**

```bash
cd apps/server
npx prisma migrate dev --name init_sqlite
```

**Railway Deployment:**
1. Add Redis
2. Deploy combined service with SQLite
3. Set `DATABASE_URL=file:/app/data/workflow.db`
4. Mount a volume at `/app/data` for persistence

**Cost:** ~$10-20/month

---

## Option 4: Serverless (Minimal Cost)

**Services:**
- Vercel/Netlify (API routes)
- Neon/PlanetScale (serverless PostgreSQL)
- Upstash (serverless Redis)

### What Works:
✅ Pay per request  
✅ Auto-scaling  
✅ Very low cost for low traffic  

### What Doesn't Work:
⚠️ Cold starts  
⚠️ Long-running workflows may timeout  
⚠️ More complex setup  

**Cost:** ~$0-10/month for low traffic

---

## Comparison Table

| Option | Services | Cost/Month | Async Jobs | Cron | UI | Best For |
|--------|----------|------------|------------|------|----|----|
| **API Only** | 2 | $10-20 | ❌ | ❌ | ❌ | Simple sync workflows |
| **Combined** | 3 | $15-30 | ✅ | ✅ | ❌ | Full features, lower cost |
| **SQLite** | 2 | $10-20 | ✅ | ✅ | ❌ | Small projects |
| **Full Stack** | 5 | $25-50 | ✅ | ✅ | ✅ | Production with UI |
| **Serverless** | 3 | $0-10 | ⚠️ | ⚠️ | ❌ | Low traffic |

---

## Recommended Approach by Use Case

### 1. **Development/Testing**
```
Setup: SQLite + Combined API/Worker
Services: 2 (API+Worker, Redis)
Cost: ~$10-20/month
```

### 2. **Production API (No UI)**
```
Setup: Combined API/Worker
Services: 3 (PostgreSQL, Redis, API+Worker)
Cost: ~$15-30/month
```

### 3. **Full Production**
```
Setup: Separate services
Services: 5 (PostgreSQL, Redis, API, Worker, Studio)
Cost: ~$25-50/month
Benefit: Independent scaling
```

### 4. **Hobby/Side Project**
```
Setup: API Only (sync)
Services: 2 (PostgreSQL, API)
Cost: ~$10-20/month
```

---

## Implementation Steps for Combined Deployment

### Step 1: Create Combined Entry Point

```bash
# Create the combined.ts file (shown above)
touch apps/server/src/combined.ts
```

Copy the combined.ts code from above.

### Step 2: Update Package Scripts

Edit `apps/server/package.json` to add combined scripts.

### Step 3: Test Locally

```bash
# Start infrastructure
docker compose -f infra/docker-compose.yml up -d

# Build
npm run build

# Run combined
npm run dev:combined -w @wfengine/server
```

### Step 4: Deploy to Railway

**Build Command:**
```bash
npm run build
```

**Start Command:**
```bash
npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
```

**Environment Variables:**
```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
PORT=3001
NODE_ENV=production
API_KEY=your-secret-key
```

---

## Scaling Considerations

### When to Use Separate Services:

**Use separate API + Worker when:**
- API traffic is high (need to scale API independently)
- Long-running workflows (worker needs more resources)
- Different resource requirements (API needs CPU, Worker needs memory)
- Production environment with high availability needs

### When to Use Combined:

**Use combined API + Worker when:**
- Low to medium traffic
- Cost is a concern
- Simpler deployment preferred
- Development/staging environments
- Workflows are relatively quick

---

## Migration Path

### From Combined → Separate Services:

1. Deploy Worker as separate service
2. Point both to same Redis
3. Gradually shift traffic
4. No downtime required

### From Separate → Combined:

1. Deploy combined service
2. Stop old API and Worker services
3. Update DNS/routing
4. Brief downtime (< 1 minute)

---

## Cost Savings Summary

| From | To | Monthly Savings |
|------|----|----|
| Full Stack (5) | Combined (3) | ~$10-20 |
| Full Stack (5) | API Only (2) | ~$15-30 |
| Combined (3) | SQLite (2) | ~$5-10 |

---

## Next Steps

1. Choose your deployment option based on requirements
2. Create combined.ts if using Option 2
3. Test locally before deploying
4. Deploy to Railway with appropriate configuration
5. Monitor performance and costs
6. Scale up when needed

---

## Support

For questions or issues:
- Check Railway logs for errors
- Verify environment variables
- Test locally first
- Review the main README.md

Happy cost-effective deploying! 💰
