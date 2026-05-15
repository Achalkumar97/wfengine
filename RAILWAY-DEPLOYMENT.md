# Railway Deployment Guide

This guide explains how to deploy the Workflow Engine SDK to Railway.app.

## Overview

Railway deployment consists of **5 services**:

1. **PostgreSQL** (Railway template)
2. **Redis** (Railway template)
3. **API Server** (from your repo)
4. **Worker** (from your repo)
5. **Studio** (from your repo)

---

## Prerequisites

- Railway account: https://railway.app
- GitHub repository with your code
- Railway CLI (optional): `npm i -g @railway/cli`

---

## Step 1: Create Railway Project

### Option A: Using Railway Dashboard

1. Go to https://railway.app/new
2. Click **"New Project"**
3. Select **"Empty Project"**
4. Name it: `workflow-engine`

### Option B: Using Railway CLI

```bash
railway login
railway init
```

---

## Step 2: Add Database Services

### Add PostgreSQL

1. In your Railway project, click **"+ New"**
2. Select **"Database"** → **"Add PostgreSQL"**
3. Railway automatically provisions the database
4. Note: `DATABASE_URL` is auto-generated

### Add Redis

1. Click **"+ New"** again
2. Select **"Database"** → **"Add Redis"**
3. Railway automatically provisions Redis
4. Note: `REDIS_URL` is auto-generated

---

## Step 3: Prepare Your Repository

### 1. Add Production Scripts

Update `apps/server/package.json`:

```json
{
  "scripts": {
    "build": "dotenv -e ../../.env -- prisma generate && tsc",
    "start": "node dist/main.js",
    "start:worker": "node dist/worker.js"
  }
}
```

### 2. Create Root Build Script

Update root `package.json`:

```json
{
  "scripts": {
    "build": "turbo run build",
    "start:api": "npm run start -w @wfengine/server",
    "start:worker": "npm run start:worker -w @wfengine/server"
  }
}
```

### 3. Create Nixpacks Configuration

Create `nixpacks.toml` in project root:

```toml
[phases.setup]
nixPkgs = ["nodejs_20", "npm"]

[phases.install]
cmds = ["npm ci"]

[phases.build]
cmds = ["npm run build"]

[start]
cmd = "npm run start:api"
```

### 4. Ensure Worker Entry Point Exists

Check that `apps/server/src/worker.ts` exists. If not, create it:

```typescript
import { startWorker } from './worker-service';

startWorker().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
```

---

## Step 4: Deploy API Server

### 1. Create New Service

1. In Railway project, click **"+ New"**
2. Select **"GitHub Repo"**
3. Connect your repository
4. Select the repository

### 2. Configure Service

**Service Name:** `api-server`

**Root Directory:** Leave as `/` (monorepo root)

**Build Command:**
```bash
npm run build
```

**Start Command:**
```bash
npm run db:migrate -w @wfengine/server && npm run start:api
```

### 3. Set Environment Variables

In the service settings, add:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
PORT=3001
NODE_ENV=production
API_KEY=your-secret-api-key-here
```

**Note:** Railway auto-links services with `${{ServiceName.VARIABLE}}`

### 4. Enable Public Domain

1. Go to service **Settings**
2. Click **"Generate Domain"** under **Networking**
3. Note the URL (e.g., `https://api-server-production.up.railway.app`)

---

## Step 5: Deploy Worker

### 1. Create New Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select the **same repository**
3. This creates a second service from the same repo

### 2. Configure Service

**Service Name:** `worker`

**Root Directory:** Leave as `/`

**Build Command:**
```bash
npm run build
```

**Start Command:**
```bash
npm run start:worker
```

### 3. Set Environment Variables

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
NODE_ENV=production
```

### 4. Disable Public Networking

Workers don't need public access:
1. Go to **Settings** → **Networking**
2. Remove any public domains

---

## Step 6: Deploy Studio (Frontend)

### Option A: Deploy on Railway

#### 1. Create New Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select the **same repository**

#### 2. Configure Service

**Service Name:** `studio`

**Root Directory:** Leave as `/`

**Build Command:**
```bash
npm run build
```

**Start Command:**
```bash
npm run preview -w examples-studio
```

Or use a static server:

```bash
npx serve apps/studio/dist -p $PORT
```

#### 3. Set Environment Variables

```
VITE_WFENGINE_API=https://your-api-server.up.railway.app
VITE_WFENGINE_API_KEY=your-secret-api-key-here
NODE_ENV=production
```

#### 4. Enable Public Domain

Generate a public domain for the studio.

### Option B: Deploy on Vercel/Netlify (Recommended for Static Sites)

Since the studio is a static Vite app, you can deploy it separately:

**Vercel:**
```bash
cd apps/studio
vercel --prod
```

**Netlify:**
```bash
cd apps/studio
npm run build
netlify deploy --prod --dir=dist
```

Set environment variables in Vercel/Netlify dashboard:
- `VITE_WFENGINE_API`
- `VITE_WFENGINE_API_KEY`

---

## Step 7: Verify Deployment

### Check API Server

```bash
curl https://your-api-server.up.railway.app/health
```

Expected: `{"status":"ok"}`

### Check API Documentation

Open in browser:
```
https://your-api-server.up.railway.app/api-docs
```

### Check Studio

Open in browser:
```
https://your-studio.up.railway.app
```

### Check Worker Logs

In Railway dashboard:
1. Click on **worker** service
2. Go to **Deployments** tab
3. Check logs for "Worker started"

---

## Railway Service Summary

| Service | Type | Public | Environment Variables |
|---------|------|--------|----------------------|
| **PostgreSQL** | Database | No | Auto-generated |
| **Redis** | Database | No | Auto-generated |
| **API Server** | Web | Yes | DATABASE_URL, REDIS_URL, PORT, API_KEY |
| **Worker** | Worker | No | DATABASE_URL, REDIS_URL |
| **Studio** | Web | Yes | VITE_WFENGINE_API, VITE_WFENGINE_API_KEY |

---

## Cost Estimation (Railway)

Railway pricing (as of 2024):

- **Hobby Plan:** $5/month + usage
  - $5 credit included
  - ~$0.000231/GB-hour for memory
  - ~$0.000463/vCPU-hour

**Estimated monthly cost:**
- PostgreSQL: ~$5-10
- Redis: ~$5-10
- API Server: ~$5-10
- Worker: ~$5-10
- Studio: ~$5-10

**Total: ~$25-50/month** depending on usage

**Free tier:** Railway offers $5 credit/month on Hobby plan.

---

## Troubleshooting

### Issue: Build Fails

**Solution:** Check build logs in Railway dashboard. Common issues:
- Missing dependencies: Ensure `package.json` is correct
- TypeScript errors: Fix before deploying
- Prisma generation: Ensure `DATABASE_URL` is set

### Issue: Database Connection Failed

**Solution:**
1. Verify `DATABASE_URL` is set correctly
2. Check PostgreSQL service is running
3. Ensure migrations ran: Check API server logs

### Issue: Worker Not Processing Jobs

**Solution:**
1. Check worker logs in Railway
2. Verify `REDIS_URL` is correct
3. Ensure Redis service is running
4. Check worker service is deployed and running

### Issue: Studio Can't Connect to API

**Solution:**
1. Verify `VITE_WFENGINE_API` points to correct API URL
2. Check CORS settings in API server
3. Verify API_KEY matches if enabled

---

## Environment Variables Reference

### API Server (`api-server` service)

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
PORT=3001
NODE_ENV=production
API_KEY=your-secret-key  # Optional but recommended
```

### Worker (`worker` service)

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
NODE_ENV=production
```

### Studio (`studio` service)

```bash
VITE_WFENGINE_API=https://api-server-production.up.railway.app
VITE_WFENGINE_API_KEY=your-secret-key  # Must match API server
NODE_ENV=production
```

---

## Updating Deployment

### Push Changes

Railway auto-deploys on git push:

```bash
git add .
git commit -m "Update workflow engine"
git push origin main
```

Railway will automatically:
1. Detect the push
2. Build all services
3. Deploy updates
4. Run health checks

### Manual Redeploy

In Railway dashboard:
1. Select service
2. Click **"Deployments"**
3. Click **"Redeploy"** on latest deployment

---

## Monitoring

### View Logs

In Railway dashboard:
1. Click on service
2. Go to **"Deployments"** tab
3. Click on active deployment
4. View real-time logs

### Metrics

Railway provides:
- CPU usage
- Memory usage
- Network traffic
- Request counts

Access via service **"Metrics"** tab.

---

## Scaling

### Horizontal Scaling

Railway supports replicas:

1. Go to service **Settings**
2. Under **"Deploy"**, increase **"Replicas"**
3. Recommended for API server under high load

### Vertical Scaling

Railway auto-scales resources, but you can set limits:

1. Go to service **Settings**
2. Set **"Memory Limit"** and **"CPU Limit"**

---

## Security Best Practices

1. **Enable API Key:** Set `API_KEY` environment variable
2. **Use HTTPS:** Railway provides SSL by default
3. **Restrict CORS:** Configure allowed origins in API server
4. **Rotate Secrets:** Regularly update API keys
5. **Monitor Logs:** Check for suspicious activity
6. **Database Backups:** Railway provides automatic backups

---

## Alternative: Docker Deployment

If you prefer Docker, create `Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY . .
RUN npm ci
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/prisma ./apps/server/prisma
COPY --from=builder /app/packages ./packages
COPY package*.json ./

EXPOSE 3001
CMD ["npm", "run", "start:api"]
```

Then in Railway:
1. Railway auto-detects Dockerfile
2. Builds and deploys container

---

## Support

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Project Issues: Check your repository issues

---

## Next Steps

After deployment:
1. Test all API endpoints
2. Create sample workflows in Studio
3. Monitor logs for errors
4. Set up custom domain (optional)
5. Configure monitoring/alerts

Happy deploying! 🚀
