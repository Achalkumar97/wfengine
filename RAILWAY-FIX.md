# Railway Deployment Fix Guide

## Problem

Railway detected 3 services but all failed to build with TypeScript module resolution errors. This happens because Railway tries to build each service independently, but this is a **monorepo** where packages depend on each other.

## Understanding the Errors

### Error 1: examples-studio
```
Cannot find module '@wfengine/ui' or its corresponding type declarations
```
**Cause:** Studio depends on `@wfengine/ui` package which wasn't built yet.

### Error 2: @wfengine/server  
```
Cannot find module '@wfengine/shared' or its corresponding type declarations
Cannot find module '@wfengine/core' or its corresponding type declarations
```
**Cause:** Server depends on shared packages that weren't built yet.

### Error 3: examples-programmatic
```
@wfengine/core:build: command exited (2)
```
**Cause:** Core package build failed, cascading to dependent packages.

---

## Solution: Proper Monorepo Configuration

Railway needs to understand this is a monorepo and build all packages before deploying individual services.

### Step 1: Remove Auto-Detected Services

In Railway dashboard:
1. Delete all 3 auto-detected services:
   - `examples-studio`
   - `@wfengine/server`
   - `examples-programmatic`

### Step 2: Deploy Only What You Need

**Don't deploy all 3!** Only deploy the services you actually need:

#### Option A: API Server Only (Recommended to start)

1. Click **"+ New"** → **"GitHub Repo"**
2. Select your repository
3. Configure:

**Service Name:** `api-server`

**Root Directory:** `/` (important - stay at monorepo root)

**Build Command:**
```bash
npm ci && npm run build
```

**Start Command:**
```bash
npm run db:migrate -w @wfengine/server && npm run start -w @wfengine/server
```

**Environment Variables:**
```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
PORT=3001
NODE_ENV=production
```

#### Option B: Combined API + Worker (Better)

Same as above but with different start command:

**Start Command:**
```bash
npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
```

**Note:** You need to create `combined.ts` first (see MINIMAL-DEPLOYMENT.md)

#### Option C: Studio (Optional - Deploy Separately)

**Better approach:** Deploy studio to **Vercel** or **Netlify** instead of Railway.

If you must use Railway:

**Service Name:** `studio`

**Root Directory:** `/`

**Build Command:**
```bash
npm ci && npm run build
```

**Start Command:**
```bash
npx serve apps/studio/dist -p $PORT
```

**Install Command:**
```bash
npm ci && npm install -g serve
```

**Environment Variables:**
```
VITE_WFENGINE_API=https://your-api-server.up.railway.app
NODE_ENV=production
```

---

## Step 3: Add Required Files to Repository

I've created configuration files that Railway needs:

### 1. `railway.toml` (already created)
Tells Railway this is a monorepo.

### 2. `nixpacks.toml` (already created)  
Configures the build process properly.

### 3. Update `apps/server/package.json`

Add production start scripts:

```json
{
  "scripts": {
    "dev": "dotenv -e ../../.env -- tsx watch src/main.ts",
    "build": "dotenv -e ../../.env -- prisma generate && tsc",
    "start": "node dist/main.js",
    "start:worker": "node dist/worker.js",
    "start:combined": "node dist/combined.js"
  }
}
```

### 4. Commit and Push

```bash
git add railway.toml nixpacks.toml
git commit -m "Add Railway monorepo configuration"
git push origin main
```

---

## What is the Worker?

### Worker Explained

The **Worker** is a separate Node.js process that handles **background jobs** using **BullMQ** (a Redis-based job queue).

#### What the Worker Does:

1. **Async Workflow Execution**
   - When you call the API with `async: true`, the workflow is queued
   - Worker picks it up and executes it in the background
   - API responds immediately without waiting

2. **Scheduled/Cron Jobs**
   - Workflows can run on a schedule (e.g., every hour, daily)
   - Worker processes these scheduled triggers
   - Example: Daily report generation, periodic data sync

3. **Webhook Processing**
   - Webhooks can trigger workflows
   - Worker processes them asynchronously
   - Prevents webhook timeouts

4. **Retry Logic**
   - Failed jobs are automatically retried
   - Configurable retry attempts and delays
   - Dead letter queue for permanently failed jobs

#### Worker Architecture:

```
┌─────────────┐
│   API Call  │
│ (async:true)│
└──────┬──────┘
       │
       ▼
┌─────────────┐      ┌─────────────┐
│    Redis    │◄────►│   Worker    │
│  Job Queue  │      │   Process   │
└─────────────┘      └──────┬──────┘
                            │
                            ▼
                     ┌─────────────┐
                     │  Execute    │
                     │  Workflow   │
                     └─────────────┘
```

#### Do You Need the Worker?

**YES, if you need:**
- ✅ Async execution (non-blocking API)
- ✅ Scheduled workflows (cron jobs)
- ✅ Long-running workflows (> 30 seconds)
- ✅ Retry failed workflows automatically
- ✅ Process webhooks in background

**NO, if:**
- ❌ All workflows are quick (< 5 seconds)
- ❌ Only need synchronous execution
- ❌ No scheduled jobs needed
- ❌ Want to minimize costs

#### Worker Code Location:

**File:** `apps/server/src/worker.ts`

```typescript
// Simplified worker code
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    // Process job
    if (job.data.type === "execute") {
      await executeWorkflow(job.data.executionId);
    }
    if (job.data.type === "cronTick") {
      await executeCronWorkflow(job.data.workflowVersionId);
    }
  },
  { 
    connection: { url: REDIS_URL },
    concurrency: 5  // Process 5 jobs simultaneously
  }
);
```

#### Worker vs API Server:

| Feature | API Server | Worker |
|---------|-----------|--------|
| **Purpose** | Handle HTTP requests | Process background jobs |
| **Execution** | Synchronous | Asynchronous |
| **Response** | Immediate | Queued |
| **Timeout** | 30-60 seconds | No timeout |
| **Scaling** | Scale for traffic | Scale for job volume |
| **Port** | 3001 (public) | None (internal) |

---

## Recommended Railway Setup

### For Production:

**Deploy 3 services:**

1. **PostgreSQL** (Railway template)
2. **Redis** (Railway template)
3. **API + Worker Combined** (your code)

**Why combined?**
- Simpler deployment
- Lower cost (~$15-30/month vs $25-50)
- Easier to manage
- Still has all features

### For Development/Testing:

**Deploy 2 services:**

1. **PostgreSQL** (Railway template)
2. **API Server Only** (your code, no Redis, no Worker)

**Why API only?**
- Cheapest (~$10-20/month)
- Good for testing
- Sync execution works fine
- Add Worker later if needed

---

## Deployment Checklist

### Before Deploying:

- [ ] Delete auto-detected services in Railway
- [ ] Add PostgreSQL database
- [ ] Add Redis (if using Worker)
- [ ] Commit `railway.toml` and `nixpacks.toml`
- [ ] Update `apps/server/package.json` with start scripts
- [ ] Push to GitHub

### Deploy API Server:

- [ ] Create new service from GitHub repo
- [ ] Set root directory to `/`
- [ ] Configure build command: `npm ci && npm run build`
- [ ] Configure start command (see options above)
- [ ] Add environment variables
- [ ] Generate public domain
- [ ] Wait for deployment
- [ ] Test `/health` endpoint

### Verify:

- [ ] Check deployment logs (no errors)
- [ ] Test API: `curl https://your-api.railway.app/health`
- [ ] Check API docs: `https://your-api.railway.app/api-docs`
- [ ] Create a test workflow via API
- [ ] Check database (workflow saved)

---

## Troubleshooting

### Build Still Fails

**Check:**
1. Root directory is `/` (not `/apps/server`)
2. Build command includes `npm ci && npm run build`
3. All packages have proper dependencies in `package.json`

**Try:**
```bash
# Test build locally first
npm ci
npm run build
```

### Module Not Found Errors

**Cause:** Packages not built in correct order

**Fix:** Ensure `turbo.json` has correct dependency order:

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    }
  }
}
```

### Worker Not Processing Jobs

**Check:**
1. Redis is running
2. `REDIS_URL` is correct
3. Worker logs show "Worker listening on queue"
4. Jobs are being added to queue (check API logs)

**Debug:**
```bash
# In Railway logs, search for:
"Worker listening on queue"
"Job failed"
"Processing job"
```

### Database Connection Failed

**Check:**
1. PostgreSQL service is running
2. `DATABASE_URL` is set correctly
3. Migrations ran successfully

**Fix:**
```bash
# Check migration logs in Railway
# Should see: "Migration applied successfully"
```

---

## Cost Optimization

### Current Setup (Failed):
- Tried to deploy 3 services: ❌ Failed
- Would cost: ~$15-30/month if working

### Recommended Setup:
- Deploy 1 service (API + Worker combined): ✅
- Plus PostgreSQL + Redis: ✅
- Total: 3 services
- Cost: ~$15-30/month

### Minimal Setup:
- Deploy 1 service (API only): ✅
- Plus PostgreSQL: ✅
- Total: 2 services
- Cost: ~$10-20/month

---

## Next Steps

1. **Delete failed services** in Railway dashboard
2. **Choose your deployment option:**
   - API + Worker Combined (recommended)
   - API Only (cheapest)
3. **Follow deployment steps** above
4. **Test thoroughly** before using in production
5. **Monitor logs** for any issues

---

## Quick Commands Reference

### Local Testing:
```bash
# Build everything
npm ci && npm run build

# Test API
npm run dev:server

# Test Worker
npm run worker -w @wfengine/server

# Test Combined
npm run dev:combined -w @wfengine/server
```

### Railway Deployment:
```bash
# Commit config files
git add railway.toml nixpacks.toml
git commit -m "Configure Railway monorepo"
git push origin main
```

### Verify Deployment:
```bash
# Health check
curl https://your-api.railway.app/health

# List workflows
curl https://your-api.railway.app/workflows

# Create workflow
curl -X POST https://your-api.railway.app/workflows \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","description":"Test workflow"}'
```

---

## Support

If you still have issues:
1. Check Railway logs (click "View logs" button)
2. Verify environment variables are set
3. Test build locally first: `npm ci && npm run build`
4. Check this guide's troubleshooting section

Good luck with your deployment! 🚀
