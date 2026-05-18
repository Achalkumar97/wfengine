# Quick Railway Configuration Reference

## 🎯 Service 3: wfengine (Backend)

### Environment Variables
```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
PORT=3001
NODE_ENV=production
API_KEY=your-secret-key
```

### Start Command
```bash
npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
```

### After Deploy
1. Generate public domain
2. Copy URL (e.g., `https://wfengine-production-xxxx.up.railway.app`)
3. Test: `curl https://your-url/health`

---

## 🎯 Service 4: studio (Frontend)

### Build Command
```bash
npm ci && npm run build:studio
```

### Start Command
```bash
npx serve apps/studio/dist -p $PORT
```

### Environment Variables
```bash
VITE_WFENGINE_API=https://wfengine-production-xxxx.up.railway.app
NODE_ENV=production
```

**IMPORTANT:** Replace `wfengine-production-xxxx.up.railway.app` with your actual wfengine URL!

### After Deploy
1. Generate public domain
2. Open in browser
3. Test creating a workflow

---

## ✅ Quick Test

```bash
# Test backend
curl https://your-wfengine-url.up.railway.app/health

# Expected: {"status":"ok"}

# Test frontend
# Open https://your-studio-url.up.railway.app in browser
```

---

## 🐛 Common Issues

### wfengine fails to start
- Check DATABASE_URL is set
- Check REDIS_URL is set
- View deployment logs

### studio shows blank page
- Check VITE_WFENGINE_API is set correctly
- Check wfengine is running
- Open browser console for errors

---

See **RAILWAY-SERVICES-CONFIG.md** for detailed instructions.
