# @wfengine/server

Optional **Fastify** service: PostgreSQL (Prisma), **BullMQ** workers, REST CRUD for workflows/versions, **executions**, **webhooks**, and **cron** registration.

Workflow routes include **`GET /workflows`** (list containers with latest version), **`POST /workflows`**, **`GET /workflows/:id`**, **`POST /workflows/:id/versions`**, and **`GET /workflow-versions/:versionId`**.

Requires **`DATABASE_URL`**, **`REDIS_URL`**, and migrations (`npm run db:migrate -w @wfengine/server` from repo root with `.env` loaded).

Scripts load **`../../.env`** via `dotenv-cli`. See the [repository README](../../README.md) for compose ports (**5433** / **6380**), env vars, and API overview.
