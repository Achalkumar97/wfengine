# Railway Services Configuration Guide

## ✅ Code Updates Completed

All necessary code changes have been pushed to GitHub. Railway will auto-deploy.

---

## 🎯 Your 4 Railway Services Configuration

### Service 1: **Postgres** (Database)
**Type:** Railway Template  
**Status:** ✅ Already configured  
**Action:** None needed

---

### Service 2: **Redis** (Queue)
**Type:** Railway Template  
**Status:** ✅ Already configured  
**Action:** None needed

---

### Service 3: **wfengine** (Backend API + Worker)

#### Settings → General
- **Service Name:** `wfengine`
- **Root Directory:** `/` (leave as root)
- **Watch Paths:** Leave default

#### Settings → Build
- **Build Command:** (leave empty - uses nixpacks.toml)
- **Install Command:** (leave empty - uses nixpacks.toml)

#### Settings → Deploy
- **Start Command:**
  ```bash
  npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
  ```

#### Settings → Environment Variables
Add these variables:

```bash
# Database (link to Postgres service)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Redis (link to Redis service)
REDIS_URL=${{Redis.REDIS_URL}}

# Server Configuration
PORT=3001
NODE_ENV=production

# Optional: API Key for security
API_KEY=your-secret-api-key-change-this

# Optional: OpenAI for LLM features
# WFENGINE_OPENAI_API_KEY=sk-...
# OPENAI_API_KEY=sk-...
```

**How to add variables:**
1. Click on `wfengine` service
2. Go to **Variables** tab
3. Click **"+ New Variable"**
4. For DATABASE_URL and REDIS_URL, use the **"${{Service.VARIABLE}}"** syntax
5. Railway will auto-link them

#### Settings → Networking
- **Generate Domain:** Click to generate a public URL
- **Copy this URL** - you'll need it for the studio service
- Example: `https://wfengine-production-xxxx.up.railway.app`

---

### Service 4: **studio** (Frontend)

#### Settings → General
- **Service Name:** `studio`
- **Root Directory:** `/` (leave as root)

#### Settings → Build
- **Build Command:**
  ```bash
  npm ci && npm run build:studio
  ```

#### Settings → Deploy
- **Start Command:**
  ```bash
  npx serve apps/studio/dist -p $PORT
  ```

#### Settings → Environment Variables
Add these variables:

```bash
# Point to your wfengine backend URL (from Service 3)
VITE_WFENGINE_API=https://wfengine-production-xxxx.up.railway.app

# Optional: API Key (must match wfengine service)
# VITE_WFENGINE_API_KEY=your-secret-api-key-change-this

# Node environment
NODE_ENV=production
```

**IMPORTANT:** Replace `wfengine-production-xxxx.up.railway.app` with your actual wfengine service URL from Service 3!

#### Settings → Networking
- **Generate Domain:** Click to generate a public URL
- This is your studio frontend URL
- Example: `https://studio-production-xxxx.up.railway.app`

---

## 🔧 Step-by-Step Configuration

### Step 1: Configure wfengine Service

1. Click on **wfengine** service in Railway
2. Go to **Settings** → **Variables**
3. Add the environment variables listed above
4. Go to **Settings** → **Networking**
5. Click **"Generate Domain"**
6. **Copy the generated URL** (you'll need this for studio)
7. Go to **Deployments** tab
8. Wait for deployment to complete
9. Check logs for "API Server listening on port 3001"

### Step 2: Test wfengine Service

```bash
# Replace with your actual wfengine URL
curl https://wfengine-production-xxxx.up.railway.app/health
```

**Expected response:**
```json
{"status":"ok"}
```

If you get this, your backend is working! ✅

### Step 3: Configure studio Service

1. Click on **studio** service in Railway
2. Go to **Settings** → **Variables**
3. Add `VITE_WFENGINE_API` with your wfengine URL from Step 1
4. Add `NODE_ENV=production`
5. Go to **Settings** → **Deploy**
6. Update **Start Command** to:
   ```bash
   npx serve apps/studio/dist -p $PORT
   ```
7. Go to **Settings** → **Networking**
8. Click **"Generate Domain"**
9. Go to **Deployments** tab
10. Click **"Redeploy"** to trigger a new deployment

### Step 4: Test studio Service

1. Open your studio URL in browser
2. You should see the workflow builder interface
3. Try creating a workflow

---

## 🐛 Troubleshooting

### wfengine Service Issues

**Problem:** Build fails with "Cannot find module"
**Solution:** 
- Check that `.railwayignore` doesn't exclude `packages/`
- Verify all dependencies are in `package.json`
- Check build logs for specific missing packages

**Problem:** "Database connection failed"
**Solution:**
- Verify `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- Check Postgres service is running
- Look for migration errors in logs

**Problem:** "Redis connection failed"
**Solution:**
- Verify `REDIS_URL=${{Redis.REDIS_URL}}`
- Check Redis service is running

### studio Service Issues

**Problem:** Build fails with "Cannot find @wfengine/core"
**Solution:**
- Ensure build command is: `npm ci && npm run build:studio`
- Check that packages are being built first

**Problem:** "Failed to fetch" errors in browser
**Solution:**
- Verify `VITE_WFENGINE_API` is set correctly
- Check wfengine service is running and accessible
- Open browser console to see exact error
- Verify CORS is enabled in wfengine

**Problem:** Blank page or 404
**Solution:**
- Check start command: `npx serve apps/studio/dist -p $PORT`
- Verify build created `apps/studio/dist` folder
- Check deployment logs for errors

---

## 📊 Service Dependencies

```
┌─────────────────────────────────────────┐
│           Railway Services              │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────┐         ┌──────────┐    │
│  │ Postgres │◄────────┤ wfengine │    │
│  └──────────┘         └─────┬────┘    │
│                             │          │
│  ┌──────────┐              │          │
│  │  Redis   │◄─────────────┘          │
│  └──────────┘                          │
│                                         │
│  ┌──────────┐         ┌──────────┐    │
│  │  studio  │────────►│ wfengine │    │
│  │(frontend)│  HTTP   │(backend) │    │
│  └──────────┘         └──────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

---

## ✅ Verification Checklist

After configuration, verify:

- [ ] Postgres service is running
- [ ] Redis service is running
- [ ] wfengine service deployed successfully
- [ ] wfengine `/health` endpoint returns `{"status":"ok"}`
- [ ] wfengine has public domain generated
- [ ] studio service deployed successfully
- [ ] studio has `VITE_WFENGINE_API` set to wfengine URL
- [ ] studio has public domain generated
- [ ] studio opens in browser without errors
- [ ] Can create workflows in studio

---

## 🎉 Success Indicators

### wfengine Service Logs Should Show:
```
✓ Prisma schema loaded
✓ Database migrations applied
✓ API Server listening on port 3001
✓ Worker listening on queue wfengine
```

### studio Service Logs Should Show:
```
✓ Built successfully
✓ Serving apps/studio/dist
✓ Accepting connections at http://0.0.0.0:$PORT
```

---

## 📝 Quick Reference

### wfengine Service
- **Purpose:** Backend API + Worker
- **Port:** 3001
- **Health Check:** `/health`
- **API Docs:** `/api-docs`
- **Start Command:** `npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server`

### studio Service
- **Purpose:** Frontend UI
- **Port:** Assigned by Railway
- **Build Output:** `apps/studio/dist`
- **Start Command:** `npx serve apps/studio/dist -p $PORT`

---

## 🔗 Useful Links

- Railway Dashboard: https://railway.app/dashboard
- Railway Docs: https://docs.railway.app
- Project README: See README.md in repo

---

## 💡 Tips

1. **Always check logs first** when debugging
2. **Use Railway's built-in metrics** to monitor performance
3. **Set up alerts** for service failures
4. **Use environment variables** for all configuration
5. **Never commit secrets** to git

---

## 🚀 Next Steps

After successful deployment:

1. Test creating a workflow via API
2. Test creating a workflow via studio UI
3. Test workflow execution
4. Set up monitoring/alerts
5. Configure custom domain (optional)

---

Good luck! 🎉
