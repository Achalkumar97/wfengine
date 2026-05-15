# Railway Deployment Checklist

## ✅ Pre-Deployment Verification

All necessary files are configured and ready for Railway deployment.

---

## Files Ready for Deployment

### ✅ Configuration Files
- [x] `.railwayignore` - Prevents deploying examples/packages
- [x] `railway.toml` - Railway monorepo configuration
- [x] `nixpacks.toml` - Build configuration
- [x] `.env.example` - Environment variable template

### ✅ Application Files
- [x] `apps/server/src/main.ts` - API server entry point
- [x] `apps/server/src/worker.ts` - Worker entry point
- [x] `apps/server/src/combined.ts` - Combined API+Worker entry point
- [x] `apps/server/package.json` - Updated with production scripts

### ✅ Package Scripts
- [x] `start` - Runs API server (production)
- [x] `start:worker` - Runs worker (production)
- [x] `start:combined` - Runs API+Worker combined (production)
- [x] `db:migrate` - Runs database migrations

---

## Deployment Options

### Option 1: API Server Only (Cheapest)
**Cost:** ~$10-20/month | **Services:** 2 (PostgreSQL + API)

**Use when:**
- Only need synchronous execution
- No scheduled jobs needed
- Minimal features

**Railway Setup:**
```
Services: PostgreSQL + API Server
Start Command: npm run db:migrate -w @wfengine/server && npm run start -w @wfengine/server
```

---

### Option 2: Combined API + Worker (Recommended) ⭐
**Cost:** ~$15-30/month | **Services:** 3 (PostgreSQL + Redis + Combined)

**Use when:**
- Need async execution
- Need scheduled jobs
- Want all features
- Want to minimize cost

**Railway Setup:**
```
Services: PostgreSQL + Redis + Combined Service
Start Command: npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
```

---

### Option 3: Separate API + Worker
**Cost:** ~$20-40/month | **Services:** 4 (PostgreSQL + Redis + API + Worker)

**Use when:**
- High traffic expected
- Need independent scaling
- Production with high availability

**Railway Setup:**
```
Services: PostgreSQL + Redis + API Server + Worker
API Start: npm run db:migrate -w @wfengine/server && npm run start -w @wfengine/server
Worker Start: npm run start:worker -w @wfengine/server
```

---

### Option 4: Full Stack with Studio
**Cost:** ~$25-50/month | **Services:** 4-5

**Use when:**
- Need visual workflow builder
- Non-technical users need access
- Full production deployment

**Railway Setup:**
```
Services: PostgreSQL + Redis + Combined + Studio
Combined Start: npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
Studio Start: npx serve apps/studio/dist -p $PORT
```

---

## Step-by-Step Deployment

### Step 1: Commit and Push ✅

```bash
# Check status
git status

# Add all files
git add .

# Commit
git commit -m "Add Railway deployment configuration"

# Push to GitHub
git push origin main
```

### Step 2: Create Railway Project

1. Go to https://railway.app
2. Login with GitHub
3. Click "New Project"
4. Select "Empty Project"
5. Name it: `workflow-engine`

### Step 3: Add PostgreSQL

1. Click "+ New"
2. Select "Database" → "Add PostgreSQL"
3. Wait for provisioning
4. Note: `DATABASE_URL` is auto-generated

### Step 4: Add Redis (if using Worker)

1. Click "+ New"
2. Select "Database" → "Add Redis"
3. Wait for provisioning
4. Note: `REDIS_URL` is auto-generated

### Step 5: Deploy API Server (or Combined)

#### 5.1 Create Service
1. Click "+ New"
2. Select "GitHub Repo"
3. Authorize Railway (if first time)
4. Select your repository

#### 5.2 Configure Build
**Settings → Build:**
- Root Directory: `/`
- Build Command: `npm ci && npm run build`
- Start Command: (Choose based on option above)

**For Combined (Recommended):**
```bash
npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
```

**For API Only:**
```bash
npm run db:migrate -w @wfengine/server && npm run start -w @wfengine/server
```

#### 5.3 Set Environment Variables
**Settings → Variables:**

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
PORT=3001
NODE_ENV=production
API_KEY=your-secret-api-key-here
```

**Optional (if using OpenAI/LLM features):**
```
WFENGINE_OPENAI_API_KEY=sk-...
OPENAI_API_KEY=sk-...
```

#### 5.4 Generate Domain
1. Settings → Networking
2. Click "Generate Domain"
3. Copy the URL (e.g., `https://workflow-engine-production.up.railway.app`)

#### 5.5 Deploy
1. Go to "Deployments" tab
2. Railway auto-deploys
3. Watch logs for success

### Step 6: Verify Deployment

#### Test Health Endpoint
```bash
curl https://your-api-server.up.railway.app/health
```

Expected: `{"status":"ok"}`

#### Test API Docs
Open in browser:
```
https://your-api-server.up.railway.app/api-docs
```

#### Create Test Workflow
```bash
curl -X POST https://your-api-server.up.railway.app/workflows \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-api-key-here" \
  -d '{"name":"Test","description":"Test workflow"}'
```

---

## Environment Variables Reference

### Required (All Deployments)
```
DATABASE_URL=${{Postgres.DATABASE_URL}}
PORT=3001
NODE_ENV=production
```

### Required (If Using Worker/Async)
```
REDIS_URL=${{Redis.REDIS_URL}}
```

### Optional (Security)
```
API_KEY=your-secret-key
```

### Optional (LLM Features)
```
WFENGINE_OPENAI_API_KEY=sk-...
OPENAI_API_KEY=sk-...
WFENGINE_OPENAI_BASE_URL=https://api.openai.com/v1
```

### Optional (GitHub Integration)
```
WFENGINE_GITHUB_TOKEN=ghp_...
```

---

## Build Commands Reference

### For All Services
**Build Command:**
```bash
npm ci && npm run build
```

### Start Commands

**API Server Only:**
```bash
npm run db:migrate -w @wfengine/server && npm run start -w @wfengine/server
```

**Combined API + Worker:**
```bash
npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
```

**Worker Only:**
```bash
npm run start:worker -w @wfengine/server
```

**Studio:**
```bash
npx serve apps/studio/dist -p $PORT
```

---

## Troubleshooting

### Build Fails
- Check Root Directory is `/`
- Verify `railway.toml` and `nixpacks.toml` exist
- Check build logs for specific errors

### Database Connection Failed
- Verify `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- Check PostgreSQL service is running
- Redeploy service

### Migrations Don't Run
- Ensure start command includes `npm run db:migrate`
- Check logs for migration errors
- Verify DATABASE_URL is correct

### Worker Not Processing Jobs
- Check `REDIS_URL` is set
- Verify Redis service is running
- Check worker logs for errors
- Ensure using combined or separate worker service

---

## Post-Deployment

### Monitor
1. Check Railway metrics (CPU, Memory, Network)
2. Review logs regularly
3. Set up alerts (Railway provides this)

### Test
1. Create workflows via API
2. Execute workflows
3. Check async execution (if using worker)
4. Test scheduled jobs (if configured)

### Optimize
1. Monitor costs
2. Scale services if needed
3. Adjust concurrency settings
4. Enable caching if beneficial

---

## Quick Commands

### Health Check
```bash
curl https://your-api.railway.app/health
```

### List Workflows
```bash
curl https://your-api.railway.app/workflows \
  -H "x-api-key: your-key"
```

### Create Workflow
```bash
curl -X POST https://your-api.railway.app/workflows \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{"name":"My Workflow","description":"Test"}'
```

### Execute Workflow
```bash
curl -X POST https://your-api.railway.app/executions \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{"workflowVersionId":"...","initialData":{}}'
```

---

## Summary

✅ **All files configured and ready**
✅ **Multiple deployment options available**
✅ **Complete documentation provided**
✅ **Ready to push and deploy**

**Recommended:** Use Option 2 (Combined API + Worker) for best balance of features and cost.

**Next Step:** Run the commands in Step 1 to commit and push, then follow the Railway setup steps.

---

## Support

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Project Docs: See README.md and other guides

Good luck with your deployment! 🚀
