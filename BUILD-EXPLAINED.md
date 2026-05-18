# Build Process Explained

## Services vs Build - What's the Difference?

### Services (What Runs on Railway)

You deploy **3 services** to Railway:

```
┌─────────────────────────────────────┐
│  Railway Services (Running 24/7)   │
├─────────────────────────────────────┤
│  1. PostgreSQL  - Database          │
│  2. Redis       - Job queue         │
│  3. wfengine    - Your app          │
│                   (API + Worker)    │
└─────────────────────────────────────┘
```

**These cost money** (~$15-30/month total)

---

### Build (What Happens Before Deployment)

Before Railway can run your app, it needs to **compile TypeScript → JavaScript**.

Your project has **6 TypeScript packages**:

```
┌─────────────────────────────────────┐
│  TypeScript Packages (Need Build)  │
├─────────────────────────────────────┤
│  1. @wfengine/shared                │
│  2. @wfengine/core                  │
│  3. @wfengine/nodes-base            │
│  4. @wfengine/nodes-agents          │
│  5. @wfengine/ui                    │
│  6. @wfengine/server                │
└─────────────────────────────────────┘
```

**These are NOT services** - they're just code that needs compilation.

---

## Why Building is Complicated

### Package Dependencies

Your packages depend on each other:

```
@wfengine/shared
    ↓ (depends on)
@wfengine/core
    ↓
@wfengine/nodes-base
    ↓
@wfengine/nodes-agents
    ↓
@wfengine/server

@wfengine/ui
    ↓
(also depends on shared)
```

**The Problem:**
- `@wfengine/core` imports from `@wfengine/shared`
- If `shared` isn't fully compiled first, `core` fails
- TypeScript can't find the types and compiled code

---

## What We Tried

### ❌ Attempt 1: Turborepo (`npm run build`)

**Command:**
```bash
npm run build
```

**What happens:**
- Uses Turborepo to build all packages
- Tries to build in parallel for speed
- Even with `dependsOn: ["^build"]`, timing issues occur
- Packages start building before dependencies finish

**Result:** ❌ FAILS

**Error:**
```
Cannot find module '@wfengine/shared' or its corresponding type declarations
```

---

### ❌ Attempt 2: Sequential Workspace Builds

**Command:**
```bash
npm run build --workspace=@wfengine/shared
npm run build --workspace=@wfengine/core
npm run build --workspace=@wfengine/nodes-base
npm run build --workspace=@wfengine/nodes-agents
npm run build --workspace=@wfengine/ui
npm run build --workspace=@wfengine/server
```

**What happens:**
- Each command runs in isolation
- TypeScript can't find compiled output from previous packages
- Workspace linking only works at runtime, not during compilation

**Result:** ❌ FAILS

**Error:**
```
Cannot find module '@wfengine/shared' or its corresponding type declarations
```

---

### ✅ Solution: TypeScript Project References

**Command:**
```bash
npx tsc --build --force
```

**What happens:**
1. TypeScript reads `tsconfig.json` at the root
2. Sees all project references
3. Builds packages in correct dependency order
4. Ensures each package is fully compiled before the next
5. Handles type declarations properly

**Result:** ✅ WORKS!

---

## The Files We Created

### 1. `tsconfig.json` (Root) ✅ COMMITTED

```json
{
  "files": [],
  "references": [
    { "path": "./packages/shared" },
    { "path": "./packages/core" },
    { "path": "./packages/nodes-base" },
    { "path": "./packages/nodes-agents" },
    { "path": "./packages/ui" },
    { "path": "./apps/server" }
  ]
}
```

**Purpose:**
- Tells TypeScript about all packages in the monorepo
- Enables TypeScript's project references feature
- This is the **official TypeScript way** to handle monorepos

**Status:** ✅ Already committed and pushed

---

### 2. `.railwayignore` ✅ COMMITTED

```
examples/
```

**Purpose:**
- Tells Railway: "Don't deploy examples folder"
- Examples stay in GitHub for developers
- Railway won't try to create services for them

**Status:** ✅ Already committed and pushed

---

### 3. `.gitignore` ✅ UPDATED

Added:
```
*.tsbuildinfo
```

**Purpose:**
- Ignores TypeScript build cache files
- These are temporary and shouldn't be in git

**Status:** ✅ Already committed and pushed

---

## How Railway Build Works

### Step 1: Railway Clones Your Repo

```
Railway reads from GitHub:
├── packages/
├── apps/
├── tsconfig.json  ← Important!
├── package.json
└── ...
```

---

### Step 2: Railway Runs Build Command

**In Railway Dashboard → wfengine service → Settings:**

**Build Command:**
```bash
npm ci && npx tsc --build --force
```

**What this does:**

1. **`npm ci`** - Installs all dependencies
   - Installs packages for all workspaces
   - Uses package-lock.json for exact versions
   - Fast and reliable

2. **`npx tsc --build --force`** - Compiles TypeScript
   - Reads `tsconfig.json` at root
   - Builds all 6 packages in correct order
   - Creates `dist/` folders with JavaScript

**Result:**
```
packages/shared/dist/       ← Compiled JavaScript
packages/core/dist/         ← Compiled JavaScript
packages/nodes-base/dist/   ← Compiled JavaScript
packages/nodes-agents/dist/ ← Compiled JavaScript
packages/ui/dist/           ← Compiled JavaScript
apps/server/dist/           ← Compiled JavaScript
```

---

### Step 3: Railway Runs Start Command

**Start Command:**
```bash
npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
```

**What this does:**

1. **`npm run db:migrate`** - Runs database migrations
   - Creates/updates database tables
   - Uses Prisma

2. **`npm run start:combined`** - Starts your app
   - Runs `node dist/combined.js`
   - Starts both API server and Worker
   - Listens on port 3001

**Result:** Your app is running! 🎉

---

## Summary

### What You Need to Know:

1. **Services (3)** - What runs 24/7 on Railway
   - PostgreSQL
   - Redis
   - wfengine (your app)

2. **Packages (6)** - What needs to be built
   - shared, core, nodes-base, nodes-agents, ui, server

3. **Build Command** - How to compile everything
   ```bash
   npm ci && npx tsc --build --force
   ```

4. **Start Command** - How to run your app
   ```bash
   npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
   ```

---

## What's Already Done ✅

- [x] Created `tsconfig.json` with project references
- [x] Created `.railwayignore` to exclude examples
- [x] Updated `.gitignore` to ignore build artifacts
- [x] Committed and pushed all changes
- [x] Tested build locally - it works!

---

## What You Need to Do Now

### 1. Update Railway Build Command

**Go to:** Railway → wfengine service → Settings → Build

**Change Build Command to:**
```bash
npm ci && npx tsc --build --force
```

### 2. Redeploy

**Go to:** Railway → wfengine service → Deployments

Click **"Redeploy"** or wait for auto-deploy

### 3. Watch Logs

The build should succeed now! Look for:
- ✅ `npm ci` completes
- ✅ `npx tsc --build` completes
- ✅ `npm run db:migrate` completes
- ✅ `Server listening at...`

---

## Why This Solution Works

### TypeScript Project References

This is the **official TypeScript feature** for monorepos:

**Benefits:**
- ✅ Builds packages in correct order automatically
- ✅ Handles type declarations properly
- ✅ Fast incremental builds
- ✅ Designed specifically for this use case

**Used by:**
- Microsoft (TypeScript itself)
- Google (Angular)
- Facebook (React)
- Many large monorepos

---

## Troubleshooting

### If Build Still Fails

1. **Check Build Command** - Must be exactly:
   ```bash
   npm ci && npx tsc --build --force
   ```

2. **Check Root Directory** - Must be `/` (root)

3. **Check tsconfig.json** - Must exist at root with references

4. **Check Logs** - Look for specific error messages

### If App Doesn't Start

1. **Check Environment Variables** - Must have:
   - `DATABASE_URL`
   - `REDIS_URL`
   - `PORT`
   - `NODE_ENV`

2. **Check Start Command** - Must be:
   ```bash
   npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
   ```

---

## Quick Reference

### Local Development

```bash
# Build everything
npx tsc --build --force

# Run API server
npm run dev:server

# Run worker
npm run worker -w @wfengine/server
```

### Railway Deployment

**Build Command:**
```bash
npm ci && npx tsc --build --force
```

**Start Command:**
```bash
npm run db:migrate -w @wfengine/server && npm run start:combined -w @wfengine/server
```

---

## Final Checklist

- [x] `tsconfig.json` created and committed
- [x] `.railwayignore` created and committed
- [x] `.gitignore` updated and committed
- [x] All changes pushed to GitHub
- [ ] Railway build command updated
- [ ] Railway redeployed
- [ ] Deployment successful

---

You're almost there! Just update the Railway build command and redeploy! 🚀
