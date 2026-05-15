# How to Run the Workflow Engine SDK

This guide walks you through setting up and running the complete workflow engine stack, including the API server, background worker, and visual studio.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Running the Stack](#running-the-stack)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Stopping Services](#stopping-services)

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Docker** and **Docker Compose** (for PostgreSQL and Redis)

Check your versions:

```bash
node --version    # Should be v18 or higher
npm --version     # Should be v9 or higher
docker --version  # Any recent version
```

---

## Initial Setup

Follow these steps **once** before running the application for the first time.

### 1. Start Infrastructure Services

Start PostgreSQL and Redis using Docker Compose:

```bash
docker compose -f infra/docker-compose.yml up -d
```

This will start:
- **PostgreSQL** on port `5433` (to avoid conflicts with system PostgreSQL on 5432)
- **Redis** on port `6380`

Verify services are running:

```bash
docker compose -f infra/docker-compose.yml ps
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

The default `.env` file contains:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/wfengine"
REDIS_URL="redis://localhost:6380"
PORT=3001
# API_KEY=your-secret-key-here  # Optional: uncomment to enable API key authentication
```

**Note:** You can customize these values if needed, but the defaults work out of the box.

### 3. Install Dependencies

Install all workspace dependencies:

```bash
npm install
```

This will install dependencies for all packages and apps in the monorepo.

### 4. Build All Packages

Build the TypeScript packages:

```bash
npm run build
```

This compiles:
- `@wfengine/shared` - Schemas and types
- `@wfengine/core` - Workflow engine
- `@wfengine/nodes-base` - Built-in nodes
- `@wfengine/nodes-agents` - Agent nodes
- `@wfengine/ui` - React components
- `@wfengine/server` - API server
- `examples-studio` - Studio app

### 5. Run Database Migrations

Apply database schema migrations:

```bash
npm run db:migrate
```

This creates the necessary tables in PostgreSQL using Prisma.

---

## Running the Stack

You need **three separate terminal windows** to run all components.

### Terminal 1: Backend API Server

Start the Fastify API server:

```bash
npm run dev:server
```

**Expected output:**

```json
{"level":30,"time":...,"msg":"Server listening at http://127.0.0.1:3001"}
{"level":30,"time":...,"msg":"Server listening at http://10.x.x.x:3001"}
```

The server is now running on **port 3001**.

**Available endpoints:**
- API Documentation: `http://localhost:3001/api-docs`
- Health Check: `http://localhost:3001/health`
- Workflows API: `http://localhost:3001/workflows`

### Terminal 2: Background Worker

Start the BullMQ worker for async job processing:

```bash
npm run worker -w @wfengine/server
```

**Expected output:**

```
Worker started and listening for jobs...
```

The worker processes:
- Async workflow executions
- Scheduled cron jobs
- Webhook-triggered workflows

### Terminal 3: Visual Studio (UI)

Start the Vite development server for the visual workflow builder:

```bash
npm run dev:studio
```

**Expected output:**

```
VITE v6.4.2  ready in 580 ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

Open your browser and navigate to **`http://localhost:5173`** to access the visual workflow editor.

---

## Verification

### 1. Check API Server

Test the health endpoint:

```bash
curl http://localhost:3001/health
```

Expected response: `{"status":"ok"}`

### 2. View API Documentation

Open in your browser:

```
http://localhost:3001/api-docs
```

You should see the Swagger UI with all available API endpoints.

### 3. Test Workflow Creation

Create a simple workflow:

```bash
curl -X POST http://localhost:3001/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Workflow",
    "description": "My first workflow"
  }'
```

### 4. Access Visual Studio

Open your browser to:

```
http://localhost:5173
```

You should see the workflow editor with:
- Node library (left panel)
- Canvas (center)
- Inspector (right panel)

---

## Troubleshooting

### Issue: Port Already in Use

**Error:** `EADDRINUSE: address already in use`

**Solution:** Change the port in `.env`:

```env
PORT=3002  # or any available port
```

### Issue: Database Connection Failed

**Error:** `Can't reach database server at localhost:5433`

**Solution:**

1. Check if PostgreSQL container is running:
   ```bash
   docker compose -f infra/docker-compose.yml ps
   ```

2. Restart the infrastructure:
   ```bash
   docker compose -f infra/docker-compose.yml restart
   ```

3. Verify the `DATABASE_URL` in `.env` matches your setup.

### Issue: Redis Connection Failed

**Error:** `Error connecting to Redis`

**Solution:**

1. Check if Redis container is running:
   ```bash
   docker compose -f infra/docker-compose.yml ps
   ```

2. Verify the `REDIS_URL` in `.env` is correct:
   ```env
   REDIS_URL="redis://localhost:6380"
   ```

### Issue: Build Errors in Studio

**Error:** `No matching export in "../../packages/ui/dist/..."`

**Solution:** Rebuild all packages:

```bash
npm run build
```

Then restart the studio:

```bash
npm run dev:studio
```

### Issue: Worker Not Processing Jobs

**Solution:**

1. Ensure Redis is running
2. Check that the worker terminal shows "Worker started"
3. Verify `REDIS_URL` in `.env` is correct
4. Restart the worker

---

## Stopping Services

### Stop Development Servers

Press `Ctrl+C` in each terminal running:
- Backend API server
- Worker
- Studio

### Stop Infrastructure

Stop and remove Docker containers:

```bash
docker compose -f infra/docker-compose.yml down
```

To also remove volumes (⚠️ **deletes all data**):

```bash
docker compose -f infra/docker-compose.yml down -v
```

---

## Quick Reference

### One-Time Setup Commands

```bash
# 1. Start infrastructure
docker compose -f infra/docker-compose.yml up -d

# 2. Setup environment
cp .env.example .env

# 3. Install dependencies
npm install

# 4. Build packages
npm run build

# 5. Run migrations
npm run db:migrate
```

### Daily Development Commands

```bash
# Terminal 1: Backend API
npm run dev:server

# Terminal 2: Worker
npm run worker -w @wfengine/server

# Terminal 3: Studio UI
npm run dev:studio
```

### Service URLs

| Service | URL | Description |
|---------|-----|-------------|
| **API Server** | `http://localhost:3001` | REST API endpoints |
| **API Docs** | `http://localhost:3001/api-docs` | Swagger UI |
| **Studio** | `http://localhost:5173` | Visual workflow editor |
| **PostgreSQL** | `localhost:5433` | Database (via Docker) |
| **Redis** | `localhost:6380` | Job queue (via Docker) |

### Useful Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build all packages |
| `npm test` | Run tests |
| `npm run example` | Run programmatic example |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run database migrations |

---

## Next Steps

- Read the [README.md](./README.md) for architecture and API details
- Check [FEATURES.md](./FEATURES.md) for available features
- See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines
- Review [docs/](./docs/) for extended documentation

---

## Support

If you encounter issues not covered in this guide:

1. Check the [GitHub Issues](https://github.com/your-repo/issues)
2. Review the logs in each terminal for error messages
3. Ensure all prerequisites are correctly installed
4. Try rebuilding: `npm run build`

Happy workflow building! 🚀
