# 🚀 Railway Configuration - Final Settings

## ✅ Code Changes Completed & Pushed

All necessary fixes have been committed and pushed to GitHub. Railway will auto-deploy.

---

## 📋 Configuration for Your 4 Services

### 1️⃣ Postgres (Database)
**Status:** ✅ Already configured  
**Action:** None needed

---

### 2️⃣ Redis (Queue)
**Status:** ✅ Already configured  
**Action:** None needed

---

### 3️⃣ wfengine (Backend API + Worker)

#### In Railway Dashboard:

**Settings → Variables:**
```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
PORT=3001
NODE_ENV=production
API_KEY=change-this-to-a-secret-key
```

**Settings → Deploy → Start Command:**
```bash
npm run db:migrate && npm run start:combined
```

**Settings → Networking:**
- Click **"Generate Domain"**
- **COPY THIS URL** - you'll need it for studio!
- Example: `https://wfengine-production-abc123.up.railway.app`

**Wait for deployment to complete, then test:**
```bash
curl https://your-wfengine-url.up.railway.app/health
```

Expected: `{"status":"ok"}` ✅

---

### 4️⃣ studio (Frontend)

#### In Railway Dashboard:

**Settings → Build → Build Command:**
```bash
npm run build:studio
```

**Settings → Deploy → Start Command:**
```bash
npm run serve:studio
```

**Settings → Variables:**
```bash
VITE_WFENGINE_API=https://your-wfengine-url.up.railway.app
NODE_ENV=production
```

⚠️ **IMPORTANT:** Replace `your-wfengine-url.up.railway.app` with the actual URL from step 3!

**Settings → Networking:**
- Click **"Generate Domain"**
- This is your studio frontend URL

**After configuration:**
- Go to **Deployments** tab
- Click **"Redeploy"** to apply changes

---

## 🎯 Step-by-Step Checklist

### Step 1: Configure wfengine
- [ ] Add all environment variables
- [ ] Set start command
- [ ] Generate public domain
- [ ] Copy the domain URL
- [ ] Wait for deployment
- [ ] Test `/health` endpoint

### Step 2: Configure studio
- [ ] Set build command
- [ ] Set start command
- [ ] Add `VITE_WFENGINE_API` with wfengine URL
- [ ] Add `NODE_ENV=production`
- [ ] Generate public domain
- [ ] Redeploy the service

### Step 3: Test Everything
- [ ] Open studio URL in browser
- [ ] Check browser console for errors
- [ ] Try creating a workflow

---

## 🐛 If Build Still Fails

### For wfengine Service:

**If you see "Cannot find module" errors:**
1. Go to Settings → Build
2. Leave **Build Command** empty (Railway will auto-detect)
3. Only set the **Start Command**
4. Redeploy

**If you see database errors:**
1. Check `DATABASE_URL=${{Postgres.DATABASE_URL}}` is set correctly
2. Make sure Postgres service is running
3. Check deployment logs for migration errors

### For studio Service:

**If build fails:**
1. Make sure build command is: `npm run build:studio`
2. Check that wfengine service built successfully first
3. View build logs for specific errors

**If you see blank page:**
1. Check `VITE_WFENGINE_API` is set to correct wfengine URL
2. Open browser DevTools → Console tab
3. Look for CORS or network errors

---

## 📊 Expected Deployment Logs

### wfengine Service (Success):
```
✓ npm ci completed
✓ npm run build completed
✓ Prisma schema loaded
✓ Database migrations applied
✓ API Server listening on port 3001
✓ Worker listening on queue wfengine
```

### studio Service (Success):
```
✓ npm run build:studio completed
✓ vite build completed
✓ dist folder created
✓ Serving apps/studio/dist
✓ Accepting connections
```

---

## 🔍 Testing Your Deployment

### Test 1: Backend Health Check
```bash
curl https://your-wfengine-url.up.railway.app/health
```
Expected: `{"status":"ok"}`

### Test 2: API Documentation
Open in browser:
```
https://your-wfengine-url.up.railway.app/api-docs
```
You should see Swagger UI with API endpoints

### Test 3: Frontend
Open in browser:
```
https://your-studio-url.up.railway.app
```
You should see the workflow builder interface

### Test 4: Create a Workflow
In the studio UI:
1. Click "New Workflow"
2. Add some nodes
3. Save the workflow
4. Check if it appears in the list

---

## 💡 Pro Tips

1. **Always configure wfengine BEFORE studio** - studio needs the wfengine URL
2. **Check logs first** when debugging - they show exactly what's failing
3. **Use Railway's variable references** - `${{Service.VARIABLE}}` auto-links services
4. **Generate domains early** - you need them for cross-service communication
5. **Redeploy after variable changes** - Railway doesn't auto-restart

---

## 🆘 Still Having Issues?

### Check These Common Mistakes:

❌ **Wrong:** `VITE_WFENGINE_API=wfengine-production.up.railway.app`  
✅ **Right:** `VITE_WFENGINE_API=https://wfengine-production.up.railway.app`

❌ **Wrong:** `DATABASE_URL=Postgres.DATABASE_URL`  
✅ **Right:** `DATABASE_URL=${{Postgres.DATABASE_URL}}`

❌ **Wrong:** Start command in Build section  
✅ **Right:** Start command in Deploy section

---

## 📞 Need Help?

1. Check the deployment logs in Railway
2. Look at browser console for frontend errors
3. Test the `/health` endpoint first
4. Verify all environment variables are set
5. Make sure all 4 services are running

---

## 🎉 Success Indicators

You'll know everything is working when:

✅ wfengine `/health` returns `{"status":"ok"}`  
✅ wfengine `/api-docs` shows Swagger UI  
✅ studio opens without errors  
✅ Browser console has no red errors  
✅ You can create and save workflows  

---

Good luck! Your deployment should work now. 🚀
