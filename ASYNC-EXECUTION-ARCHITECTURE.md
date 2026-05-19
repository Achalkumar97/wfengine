# Async Workflow Execution Architecture

Production-grade async execution for the AI workflow engine — eliminates Railway/proxy timeouts for long-running multi-agent orchestration.

---

## Table of Contents

- [Problem](#problem)
- [Solution Overview](#solution-overview)
- [Architecture Diagram](#architecture-diagram)
- [Migration Path](#migration-path)
- [Implementation Details](#implementation-details)
  - [Part 1 — Execution Model](#part-1--execution-model)
  - [Part 2 — Execution Storage](#part-2--execution-storage)
  - [Part 3 — Status APIs](#part-3--status-apis)
  - [Part 4 — Live Updates (SSE)](#part-4--live-updates-sse)
  - [Part 5 — Frontend Studio](#part-5--frontend-studio)
  - [Part 6 — Agent/Tool Debugging](#part-6--agenttool-debugging)
  - [Part 7 — Resiliency](#part-7--resiliency)
  - [Part 8 — Performance](#part-8--performance)
- [Files Changed](#files-changed)
- [API Reference](#api-reference)
- [Database Schema Changes](#database-schema-changes)
- [Environment Variables](#environment-variables)
- [Scalability](#scalability)

---

## Problem

The old execution path held an HTTP connection open for the entire duration of a workflow run:

```
Client → POST /runs/inline/stream → [AI agents run for 2–10 minutes] → response
```

Railway (and most reverse proxies) enforce a **30-second idle/response timeout**. Long AI multi-agent workflows exceed this, causing silent connection drops and lost results.

---

## Solution Overview

Decouple execution from the HTTP request lifecycle:

1. **`POST /runs`** — validates, persists, enqueues, returns `executionId` in ~50ms
2. **BullMQ worker** — picks up the job, runs the workflow engine, publishes live events
3. **`GET /runs/:id/stream`** — SSE stream carries small JSON events (no heavy payload held open)
4. **Polling fallback** — `GET /runs/:id/status` for environments where SSE is unavailable

No single HTTP request blocks for more than a few seconds.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Studio (Frontend)                                                  │
│                                                                     │
│  [Run (Async)] ──► POST /runs ──────────────────────────────────►  │
│                    ◄── { executionId, status: "queued" } ──────────  │
│                                                                     │
│  GET /runs/:id/stream (SSE) ◄──────────────────────────────────── │
│  ├── execution_queued                                               │
│  ├── execution_started                                              │
│  ├── node_started  (per node)                                       │
│  ├── node_completed (per node)                                      │
│  └── execution_completed / execution_failed                         │
│                                                                     │
│  Polling fallback: GET /runs/:id/status (every 1.5s)               │
└─────────────────────────────────────────────────────────────────────┘
         │                              ▲
         │ POST /runs                   │ SSE events
         ▼                              │
┌─────────────────────┐      ┌──────────────────────────┐
│   API Server        │      │   ExecutionEventBus       │
│                     │      │   (Redis pub/sub)         │
│  creates Execution  │      │                           │
│  row in Postgres    │      │  channel: wfengine:exec:  │
│                     │      │          {executionId}    │
│  enqueues BullMQ    │      └──────────────────────────┘
│  job                │               ▲
└─────────────────────┘               │ publish events
         │                            │
         │ job                        │
         ▼                            │
┌─────────────────────────────────────────────────────┐
│   BullMQ Worker                                     │
│                                                     │
│  1. Check cancellation (status === "cancelled")     │
│  2. markExecutionRunning()                          │
│  3. engine.execute() with onNodeProgress callback   │
│     ├── node start  → publish node_started event    │
│     └── node end    → publish node_completed event  │
│  4. markExecutionCompleted() / markExecutionFailed() │
│  5. publish execution_completed / execution_failed  │
│                                                     │
│  Concurrency: 5 │ Retries: 3 │ Backoff: exponential │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐
│   PostgreSQL        │
│                     │
│  Execution row:     │
│  - status           │
│  - logs.events[]    │
│  - logs.currentNode │
│  - logs.progress%   │
│  - startedAt        │
│  - finishedAt       │
│  - errorSummary     │
└─────────────────────┘
```

---

## Migration Path

### Before (synchronous, timeout-prone)

```typescript
// Studio calls this and waits for the entire workflow to finish
POST /runs/inline/stream
Content-Type: application/x-ndjson

// Server holds connection open for entire execution duration
// → Railway kills it after 30s
```

### After (async, timeout-safe)

```typescript
// Step 1: enqueue (returns in ~50ms)
POST /runs
{ "definition": {...}, "initialData": {...} }
→ { "executionId": "abc-123", "status": "queued" }

// Step 2: subscribe to live events
GET /runs/abc-123/stream          // SSE — small events only
GET /runs/abc-123/status          // polling fallback

// Step 3: get result when done
GET /runs/abc-123                 // full execution record
GET /runs/abc-123/events          // all stored events for replay
```

### Backward compatibility

`POST /runs/inline/stream` and `POST /runs/inline` are **unchanged**. Existing integrations continue to work. The new async path is additive.

---

## Implementation Details

### Part 1 — Execution Model

**File:** `apps/server/src/run-workflow.ts`

The worker calls `executeExecutionRecord()` which:

1. Loads the workflow definition (from persisted version or inline definition stored in `logs.inlineDefinition`)
2. Calls `markExecutionRunning()` — sets `status = "running"`, `startedAt = now()`
3. Publishes `execution_started` event to Redis
4. Runs `engine.execute()` with `onNodeProgress` callback
5. On each node start/complete: publishes event + appends to `logs.events[]` + updates `logs.currentNodeId` + calculates `logs.progressPercent`
6. On completion: calls `markExecutionCompleted()` or `markExecutionFailed()`
7. Publishes `execution_completed` or `execution_failed`

**Execution states:**

| State | Description |
|---|---|
| `queued` | Job created, waiting for worker |
| `running` | Worker picked up job, engine executing |
| `completed` | All nodes finished successfully |
| `failed` | One or more nodes failed (or engine threw) |
| `cancelled` | Cancelled via `DELETE /runs/:id` |

**Timestamps stored:**

| Field | Set when |
|---|---|
| `createdAt` | Row created (DB default) |
| `startedAt` | Worker begins execution |
| `finishedAt` | Execution reaches terminal state |

---

### Part 2 — Execution Storage

**File:** `apps/server/src/execution-repository.ts`

Centralised repository — no direct `prisma.execution` calls in route handlers.

```typescript
class ExecutionRepository {
  createExecution(params)           // creates row with status="queued"
  markExecutionRunning(id)          // status="running", startedAt=now
  markExecutionCompleted(id, result)// status="completed", result=JSON
  markExecutionFailed(id, error)    // status="failed", errorSummary=msg
  markExecutionCancelled(id)        // status="cancelled"
  updateExecution(id, fields)       // patches currentNodeId, progressPercent
  appendExecutionEvent(id, event)   // appends to logs.events[] (cap: 2000)
  getExecution(id)                  // full record with workflowVersion
  getExecutionEvents(id)            // logs.events[] array
  getExecutionStatus(id)            // lightweight status projection
  getInlineDefinition(id)           // logs.inlineDefinition for inline runs
}
```

**Storage layout in `logs` JSON column:**

```json
{
  "events": [...],
  "currentNodeId": "node-abc",
  "currentAgentName": "Researcher",
  "progressPercent": 45,
  "inlineDefinition": { "definition": {...}, "agentLibrary": {...} }
}
```

Events are capped at **2000 entries** per execution to prevent unbounded growth.

---

### Part 3 — Status APIs

**File:** `apps/server/src/routes/runs.ts`

| Method | Path | Description |
|---|---|---|
| `POST` | `/runs` | Enqueue async execution, returns `{ executionId, status: "queued" }` |
| `GET` | `/runs/:executionId` | Full execution record |
| `GET` | `/runs/:executionId/status` | Lightweight status for polling |
| `GET` | `/runs/:executionId/events` | All stored events (replay) |
| `GET` | `/runs/:executionId/stream` | SSE live event stream |
| `DELETE` | `/runs/:executionId` | Cancel queued or running execution |

**`POST /runs` request body:**

```typescript
{
  // Option A: inline definition (Studio / dev)
  definition?: WorkflowDefinition;
  agentLibrary?: AgentLibraryDocument;
  singleNodeRun?: { nodeId: string; seedOutputs: Record<string, unknown> };

  // Option B: persisted version
  workflowVersionId?: string;

  // Both options
  initialData?: unknown;
}
```

**`GET /runs/:id/status` response:**

```typescript
{
  executionId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progressPercent?: number;       // 0–100
  currentNodeId?: string;         // node currently executing
  currentAgentName?: string;      // agent currently running
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  workflowId?: string;
}
```

---

### Part 4 — Live Updates (SSE)

**File:** `apps/server/src/execution-event-bus.ts`

Uses **Redis pub/sub** via two ioredis connections (one publisher, one subscriber — required by Redis protocol).

**Channel naming:** `wfengine:exec:{executionId}`

**Event types emitted:**

| Event | When |
|---|---|
| `execution_queued` | Job enqueued via `POST /runs` |
| `execution_started` | Worker begins execution |
| `execution_completed` | Workflow finished successfully |
| `execution_failed` | Workflow failed |
| `node_started` | Node begins executing |
| `node_completed` | Node finishes (ok or failed) |
| `agent_turn_started` | Multi-agent turn begins |
| `agent_turn_completed` | Multi-agent turn ends |
| `tool_call_started` | OpenAI tool call dispatched |
| `tool_call_completed` | Tool call returned |
| `openai_call_started` | HTTP request to OpenAI begins |
| `openai_call_completed` | HTTP response received (includes token usage) |
| `log` | Structured log entry |

**SSE stream format:**

```
id: 0
data: {"type":"execution_started","executionId":"abc","timestamp":"..."}

id: 1
data: {"type":"node_started","nodeId":"fetch-data","nodeType":"http.request",...}

: keepalive

id: 2
data: {"type":"node_completed","nodeId":"fetch-data","ok":true,"durationMs":342,...}

id: 3
data: {"type":"stream_end","status":"completed"}
```

- Keepalive comment sent every **15 seconds** to prevent proxy timeouts
- `id:` field enables reconnect with `Last-Event-ID` header
- On reconnect, stored events are **replayed from DB** before subscribing to live events
- `X-Accel-Buffering: no` header disables nginx buffering

**Graceful degradation:** If Redis is unavailable, the SSE route returns stored events and closes. The frontend falls back to polling automatically.

---

### Part 5 — Frontend Studio

**New files:**
- `apps/studio/src/useAsyncRun.ts` — React hook managing the full async run lifecycle
- `apps/studio/src/ExecutionProgressPanel.tsx` — Live progress UI component
- `apps/studio/src/server-api.ts` — Extended with async execution API functions

**`useAsyncRun` hook:**

```typescript
const asyncRun = useAsyncRun({
  onNodeStarted: (nodeId, nodeType) => { ... },
  onNodeCompleted: (nodeId, nodeType, ok, error) => { ... },
  onFinished: (state) => { ... },
});

// Start an async run
const executionId = await asyncRun.start({
  definition,
  initialData,
  agentLibrary,
  orderedNodes,   // for initialising liveSteps as "pending"
});

// Cancel
await asyncRun.cancel();

// Reset to idle
asyncRun.reset();

// State
asyncRun.state  // { phase: "idle"|"queued"|"running"|"completed"|"failed"|"cancelled", ... }
asyncRun.liveSteps  // LiveRunStep[] — per-node status
```

**SSE subscription in `server-api.ts`:**

Uses `fetch()` + `ReadableStream` instead of `EventSource` so custom `x-api-key` headers work:

```typescript
const unsubscribe = subscribeToExecutionStream(
  executionId,
  (event) => { /* handle event */ },
  (terminalStatus) => { /* "completed" | "failed" | "cancelled" */ },
  (err) => { /* SSE failed — switch to polling */ },
);

// Cleanup
unsubscribe();
```

**Polling fallback:**

```typescript
const stopPoll = pollExecutionStatus(
  executionId,
  (status) => { /* update UI */ },
  (terminalStatus) => { /* done */ },
  1500, // interval ms
);
```

**Studio toolbar:** Two run buttons:

| Button | Path | Use case |
|---|---|---|
| **Run** | `POST /runs/inline/stream` | Quick dev runs, short workflows |
| **Run (Async)** | `POST /runs` + SSE | Production, long AI workflows, timeout-safe |

---

### Part 6 — Agent/Tool Debugging

**File:** `packages/nodes-agents/src/runtime/openai-tool-loop.ts`

Every significant boundary in the OpenAI tool loop now emits a structured log entry via the `WorkflowLogger` interface.

**Log events emitted:**

```
STREAM_START              — loop begins (maxIterations, toolCount, messageCount)
TOOL_LOOP_ITERATION       — each iteration (turn, elapsed, remaining)
OPENAI_CALL_START         — before fetch() (url, toolChoice, toolCount)
OPENAI_CALL_END           — after response (durationMs, finishReason, tokens)
OPENAI_CALL_FAILED        — on error (durationMs, error message)
TOOL_EXECUTION_START      — before dispatching a tool call (toolName, toolIndex, toolKind)
TOOL_EXECUTION_END        — after tool returns (durationMs, ok)
TOOL_RESULT_SENT_TO_MODEL — after pushing tool result to messages (resultLength, ok)
STREAM_END                — loop exits normally (totalIterations, totalDurationMs)
STREAM_END_MAX_ITERATIONS — loop hit iteration cap
```

**All log entries include:**

```typescript
{
  executionId: string;
  workflowId: string;
  nodeId: string;
  agentName: string;
  model: string;
  provider: "openai" | "ollama";
  turn: number;
  // event-specific fields...
}
```

**Token usage** (when available from OpenAI response):

```typescript
{
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

**Usage in agent nodes:**

```typescript
await runOpenAiToolLoop({
  // ...existing params...
  logger: context.logger,           // WorkflowLogger from execution context
  executionContext: {
    executionId: context.executionId,
    workflowId: context.workflowId,
    nodeId: nodeId,
    agentName: config.agentName,
  },
});
```

---

### Part 7 — Resiliency

**Retry support** — BullMQ job options:

```typescript
queue.add("execute", payload, {
  jobId: executionId,
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
});
```

**Stalled job recovery:**

```typescript
new Worker(QUEUE_NAME, handler, {
  stalledInterval: 30_000,   // check every 30s
  maxStalledCount: 2,        // re-queue up to 2 times before failing
});
```

**Cancellation support:**

- `DELETE /runs/:executionId` sets `status = "cancelled"` in DB
- Worker checks `status === "cancelled"` before starting execution
- BullMQ job is removed from queue if still pending
- `execution_failed` event published with `error: "Cancelled by user"`

**Graceful shutdown** (both `worker.ts` and `combined.ts`):

```typescript
process.on("SIGTERM", async () => {
  await worker.close();          // finish in-flight jobs, stop accepting new ones
  await EventBus.get().close();  // close Redis connections
  await prisma.$disconnect();
  process.exit(0);
});
```

**Failed execution persistence:**

All failures — whether from node errors, engine throws, or worker crashes — are persisted to the `Execution` row with `status = "failed"` and `errorSummary` set. The full error is also appended to `logs.events[]`.

---

### Part 8 — Performance

**No blocking HTTP requests** — `POST /runs` does three fast operations (DB write, Redis enqueue, response) and returns. The API server is never blocked by workflow execution.

**Concurrent workflows** — worker concurrency is 5 by default. Each job runs in its own async context. Increase `concurrency` in `worker.ts` / `combined.ts` to scale.

**SSE vs WebSocket** — SSE was chosen over WebSocket because:
- Works through all HTTP/1.1 proxies without upgrade negotiation
- Simpler server implementation (no ws library needed)
- Automatic reconnect built into the browser `EventSource` spec
- One-directional (server → client) is all that's needed here

**Event bus isolation** — Redis pub/sub uses two dedicated ioredis connections (publisher + subscriber). These are separate from the BullMQ connection pool, preventing pub/sub subscription mode from blocking queue operations.

**Event cap** — `logs.events[]` is capped at 2000 entries per execution. For very long workflows, only the most recent events are kept in the DB. The SSE stream always delivers all events in real time regardless of the cap.

**OpenAI tool loops** — run entirely inside the BullMQ worker process, never on the API server. The API server handles only lightweight HTTP routing.

---

## Files Changed

### New files

| File | Description |
|---|---|
| `apps/server/src/execution-event-bus.ts` | Redis pub/sub event bus |
| `apps/server/src/execution-repository.ts` | Execution persistence layer |
| `apps/server/src/routes/runs.ts` | All `/runs` route handlers |
| `apps/studio/src/useAsyncRun.ts` | React hook for async run lifecycle |
| `apps/studio/src/ExecutionProgressPanel.tsx` | Live progress UI component |
| `apps/server/prisma/migrations/20260519000000_add_execution_createdat_indexes/migration.sql` | DB migration |

### Modified files

| File | Changes |
|---|---|
| `apps/server/src/run-workflow.ts` | Publishes events, uses repository, supports inline definitions |
| `apps/server/src/worker.ts` | Event bus init, cancellation check, graceful shutdown |
| `apps/server/src/combined.ts` | Same as worker.ts |
| `apps/server/src/main.ts` | Event bus init, graceful shutdown |
| `apps/server/src/app.ts` | Registers `/runs` routes |
| `apps/server/src/index.ts` | Exports new modules |
| `apps/server/prisma/schema.prisma` | Added `createdAt`, `status` index, `createdAt` index to `Execution` |
| `packages/nodes-agents/src/runtime/openai-tool-loop.ts` | Full structured instrumentation |
| `packages/nodes-agents/src/nodes/autogen-agent.ts` | Passes logger + executionContext to tool loop |
| `packages/nodes-agents/src/runtime/autogen-orchestrator.ts` | Passes logger to tool loop |
| `apps/studio/src/server-api.ts` | Added async execution API functions |
| `apps/studio/src/App.tsx` | Added `useAsyncRun`, `ExecutionProgressPanel`, "Run (Async)" button |

---

## API Reference

### `POST /runs`

Enqueue an async workflow execution.

**Request:**
```json
{
  "definition": { "id": "my-wf", "nodes": [...], "edges": [...] },
  "initialData": { "query": "hello" },
  "agentLibrary": { "schemaVersion": 1, "agents": [...] }
}
```

**Response `202`:**
```json
{
  "executionId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "createdAt": "2026-05-19T12:00:00.000Z"
}
```

---

### `GET /runs/:executionId/status`

**Response `200`:**
```json
{
  "executionId": "550e8400-...",
  "status": "running",
  "progressPercent": 45,
  "currentNodeId": "summarise-results",
  "currentAgentName": null,
  "startedAt": "2026-05-19T12:00:01.000Z",
  "completedAt": null,
  "error": null,
  "workflowId": "my-wf"
}
```

---

### `GET /runs/:executionId/stream`

Server-Sent Events stream. Connect immediately after `POST /runs`.

**Headers set by server:**
```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
```

**Event stream example:**
```
id: 0
data: {"type":"execution_started","executionId":"550e8400-...","timestamp":"..."}

id: 1
data: {"type":"node_started","nodeId":"fetch-data","nodeType":"http.request","timestamp":"..."}

: keepalive

id: 2
data: {"type":"node_completed","nodeId":"fetch-data","ok":true,"durationMs":312,"timestamp":"..."}

id: 3
data: {"type":"execution_completed","status":"completed","completedAt":"...","timestamp":"..."}

id: 4
data: {"type":"stream_end","status":"completed","timestamp":"..."}
```

---

### `DELETE /runs/:executionId`

Cancel a queued or running execution.

**Response `200`:**
```json
{ "executionId": "550e8400-...", "status": "cancelled" }
```

**Response `409`** (already terminal):
```json
{ "error": "Cannot cancel execution in terminal state: completed" }
```

---

## Database Schema Changes

```prisma
model Execution {
  id                String          @id @default(uuid())
  workflowVersionId String
  workflowVersion   WorkflowVersion @relation(...)
  status            String          // queued | running | completed | failed | cancelled
  initialData       Json?
  result            Json?
  errorSummary      String?
  /// { events: ExecutionEvent[], currentNodeId?, currentAgentName?,
  ///   progressPercent?, inlineDefinition? }
  logs              Json?
  queued            Boolean         @default(false)
  createdAt         DateTime        @default(now())   // NEW
  startedAt         DateTime?
  finishedAt        DateTime?

  @@index([workflowVersionId])
  @@index([status])        // NEW — for querying by status
  @@index([createdAt])     // NEW — for time-range queries
}
```

**Migration:** `prisma/migrations/20260519000000_add_execution_createdat_indexes/migration.sql`

Run with:
```bash
npm run db:migrate -w @wfengine/server
```

---

## Environment Variables

No new environment variables required. The existing `REDIS_URL` and `DATABASE_URL` are used by the event bus and repository respectively.

| Variable | Used by | Description |
|---|---|---|
| `REDIS_URL` | Event bus, BullMQ | Redis connection for pub/sub and job queue |
| `DATABASE_URL` | Prisma | PostgreSQL connection |
| `API_KEY` | Auth middleware | Optional API key for all routes |

---

## Scalability

### Horizontal scaling

- **Multiple API servers** — stateless, all share the same Redis and Postgres
- **Multiple workers** — each worker subscribes to the same BullMQ queue; jobs are distributed automatically
- **Event bus** — Redis pub/sub fan-out means any API server can serve SSE for any execution, regardless of which worker is running it

### Tuning concurrency

In `apps/server/src/worker.ts` and `combined.ts`:

```typescript
new Worker(QUEUE_NAME, handler, {
  concurrency: 5,  // increase for more parallel executions per worker process
});
```

### Recommended Railway deployment

```
Service 1: combined (API + Worker)   — handles both HTTP and job processing
Service 2: PostgreSQL                — managed database
Service 3: Redis                     — managed Redis (Railway Redis plugin)
```

For higher load, split into separate services:

```
Service 1: API server (main.ts)      — scales horizontally
Service 2: Worker (worker.ts)        — scales horizontally
Service 3: PostgreSQL
Service 4: Redis
```


---

## Deep Debugging Instrumentation — OpenAI Multi-Agent Runtime

Added to `packages/nodes-agents` to trace exactly where `action_executor` hangs with "Connection timeout" inside `runOpenAiToolLoop()`.

### Problem being diagnosed

Suspected causes of the hang:

- Malformed OpenAI tool-call continuation (wrong `tool_call_id`)
- Invalid `tool_call_id` mapping between assistant and tool messages
- Recursive tool loop (model keeps calling tools, never returns text)
- Malformed assistant/tool message ordering
- Oversized tool result payload blocking the stream
- Hanging stream parser / AbortController not firing

---

### New file: `packages/nodes-agents/src/runtime/tool-loop-debug.ts`

Standalone debug utilities module — zero external dependencies, safe to import anywhere.

#### `safeJsonStringify(value, indent?)`

Circular-reference-safe JSON serialisation. Handles `BigInt`, `Function`, `Symbol`, `Error`, and nested cycles. Never throws.

```typescript
safeJsonStringify({ a: 1, b: circularRef })
// → '{"a":1,"b":"[Circular]"}'
```

#### `truncateLargePayload(value, limit?)`

Caps any value at `LOG_PAYLOAD_LIMIT` (2000 chars) with a suffix showing how many chars were removed.

```typescript
truncateLargePayload(hugeString, 200)
// → "first 200 chars…[truncated 4800 chars, total 5000]"
```

#### `summarizeMessages(messages, lastN?)`

Compact summary of a messages array for log output. Returns:

```typescript
{
  totalCount: number;
  roleCounts: { system: 1, user: 3, assistant: 2, tool: 2 };
  messageOrder: ["system", "user", "assistant[tool_calls:2]", "tool", "tool", "assistant"];
  lastMessages: [{ index, role, contentPreview, toolCallIds?, toolCallId? }];
}
```

#### `validateToolProtocol(messages)`

Pre-flight protocol checker run **before every tool result is sent to OpenAI**. Detects all 8 violation types:

| Code | What it catches |
|---|---|
| `MISSING_TOOL_CALL_ID` | Tool message or tool_call with empty/missing id |
| `MISSING_ASSISTANT_BEFORE_TOOL` | Tool message with no preceding assistant with tool_calls |
| `TOOL_CALL_ID_MISMATCH` | `tool_call_id` doesn't match any pending assistant tool_call |
| `DUPLICATE_TOOL_CALL_ID` | Same id used twice in one assistant batch |
| `NON_STRING_TOOL_CONTENT` | Tool content is not a string (OpenAI requires string) |
| `OVERSIZED_PAYLOAD` | Individual tool result exceeds 50k chars |
| `UNDEFINED_FIELD` | null/undefined role on any message |
| `ORPHAN_TOOL_MESSAGE` | Tool message before any assistant message |

Critical violations (`MISSING_TOOL_CALL_ID`, `TOOL_CALL_ID_MISMATCH`, `MISSING_ASSISTANT_BEFORE_TOOL`) **throw immediately** with a descriptive error rather than sending malformed messages to OpenAI.

#### `ToolLoopDebugLogger`

Typed wrapper around `WorkflowLogger` that stamps every entry with:

```typescript
{
  timestamp: "2026-05-19T12:00:00.000Z",
  executionId: "550e8400-...",
  workflowId: "my-workflow",
  nodeId: "action_executor",
  agentName: "Executor",
  model: "gpt-4o",
  provider: "openai",
  // ...event-specific fields
}
```

#### Constants

| Constant | Value | Purpose |
|---|---|---|
| `LOG_PAYLOAD_LIMIT` | 2,000 chars | Max chars shown in any single log field |
| `TOOL_RESULT_WARN_LIMIT` | 50,000 chars | Triggers oversized payload warning |
| `TOOL_RESULT_HARD_LIMIT` | 200,000 chars | Hard cap — result truncated before sending to OpenAI |

---

### Rewritten: `packages/nodes-agents/src/runtime/openai-tool-loop.ts`

Every boundary emits a labelled structured log entry. All entries carry `executionId`, `workflowId`, `nodeId`, `agentName`, `model`, `provider`, `timestamp`.

#### Complete log event reference

| Label | Level | Fires when | Key fields logged |
|---|---|---|---|
| `===== STREAM START =====` | info | Loop begins | maxIterations, toolCount, toolNames, messageCount, timeoutMs, baseUrl, initialToolChoice, messageSummary |
| `===== TOOL LOOP ITERATION =====` | info | Each iteration | turn, totalIterations, elapsedMs, remainingMs, roundBudgetMs, messageCount, anyToolRoundCompletedOk, messageOrder |
| `===== BEFORE OPENAI CALL =====` | info | Before every `fetch()` | turn, url, toolChoice, toolsEnabled, toolCount, toolSpecs, messageCount, roleCounts, messageOrder, lastMessage (role/contentPreview/hasToolCalls/toolCallId), last3Messages, roundBudgetMs, remainingMs |
| `===== TIMEOUT =====` | **error** | `AbortController.abort()` fires | turn, roundBudgetMs, elapsedMs, operation, url, messageCount, note |
| `===== OPENAI HTTP ERROR =====` | **error** | Non-2xx HTTP response | turn, httpStatus, httpStatusText, durationMs, responsePreview, url, timedOut |
| `===== OPENAI CALL FAILED =====` | **error** | `fetch()` throws | turn, durationMs, isAbort, timedOut, roundBudgetMs, error, errorName, url, note |
| `===== RESPONSE PARSE FAILED =====` | **error** | `JSON.parse` fails on response | turn, rawPreview, rawLength, error |
| `===== AFTER OPENAI CALL =====` | info | After response received | turn, durationMs, finishReason, hasToolCalls, toolCallCount, toolCallIds, toolCallNames, assistantContentPreview, assistantContentLength, promptTokens, completionTokens, totalTokens, streamCompleted, apiError |
| `===== OPENAI API ERROR IN RESPONSE =====` | **error** | HTTP 200 but body has `error` object | turn, apiError, note |
| `===== NO MESSAGE IN RESPONSE =====` | **error** | `choices[0].message` missing | turn, rawPreview, choices count |
| `===== ASSISTANT TOOL_CALLS PUSHED =====` | debug | After pushing assistant message | turn, toolCallCount, toolCallIds, toolCallNames, assistantContent, messageCountAfterPush |
| `===== TOOL EXECUTION START =====` | info | Before dispatching each tool | turn, toolCallId, toolName, toolFunctionName, toolIndex, toolKind, argsPreview, argsKeys, rawArgumentsLength, toolCallIdValid |
| `===== TOOL NOT FOUND =====` | warn | Unknown function name from model | turn, toolCallId, functionName, availableTools |
| `===== TOOL EXECUTION THREW =====` | **error** | Tool dispatch threw an exception | turn, toolCallId, toolName, error, stack |
| `===== TOOL EXECUTION END =====` | info | After tool returns | turn, toolCallId, toolName, toolIndex, durationMs, ok, resultType, resultChars, resultPreview, resultIsJson, oversized, errorInResult |
| `===== TOOL RESULT TRUNCATED =====` | warn | Result exceeded 200k hard limit | turn, toolName, originalChars, truncatedChars, hardLimit |
| `===== SENDING TOOL RESULT BACK TO OPENAI =====` | **info** | Before injecting tool result into messages | turn, toolCallId, toolName, toolContentChars, toolContentPreview, toolContentIsString, messageStructure (totalMessages, roleOrder, lastAssistantToolCallIds, thisToolCallId, toolCallIdMatch), protocolValid, protocolViolations, totalPayloadChars, payloadWarning |
| `===== PROTOCOL VIOLATION DETECTED =====` | **error** | Protocol check fails | turn, toolCallId, toolName, violations array, note |
| `===== TOOL BATCH ERROR =====` | **error** | Any tool returned `{ error: ... }` | turn, error, note |
| `===== STREAM END =====` | info | Normal exit | totalIterations, totalDurationMs, outputLength, outputPreview, finishReason, exitReason |
| `===== STREAM END — NO TOOLS CALLED =====` | **error** | Empty content, no tools called | turn, finishReason, toolCount, anyToolRoundCompletedOk |
| `===== STREAM END — UNEXPECTED =====` | **error** | Empty content, no finish_reason | turn, finishReason, contentLength |
| `===== STREAM END — MAX ITERATIONS =====` | **error** | Hit iteration cap | maxIterations, totalDurationMs, messageCount, messageSummary (last 5 messages) |

#### The most important log — `SENDING TOOL RESULT BACK TO OPENAI`

This fires right before each tool result is injected into the messages array. It shows the **exact message structure** that will be sent on the next OpenAI call, making it possible to spot any protocol violation:

```
===== SENDING TOOL RESULT BACK TO OPENAI =====
{
  "turn": 2,
  "toolCallId": "call_abc123",
  "toolName": "workflow_node:send-email",
  "toolContentChars": 142,
  "toolContentPreview": "{\"success\":true,\"messageId\":\"msg_xyz\"}",
  "toolContentIsString": true,
  "messageStructure": {
    "totalMessages": 7,
    "roleOrder": ["system","user","assistant","user","assistant[tool_calls:1]","tool","tool"],
    "lastAssistantToolCallIds": ["call_abc123"],
    "thisToolCallId": "call_abc123",
    "toolCallIdMatch": true
  },
  "protocolValid": true,
  "protocolViolations": [],
  "totalPayloadChars": 3842,
  "payloadWarning": false
}
```

If `toolCallIdMatch` is `false` or `protocolValid` is `false`, that is the exact cause of the hang.

---

### Updated: `packages/nodes-agents/src/runtime/autogen-orchestrator.ts`

Added per-turn instrumentation around every agent turn:

| Label | Level | Key fields |
|---|---|---|
| `autogen.multi-agent: orchestration start` | info | teamName, agentCount, agentNames, maxTurns, toolCount, model, provider, timeoutMs, multiAgentToolBinding |
| `autogen.multi-agent: ===== AGENT TURN START =====` | info | agent, turn, turnLabel, elapsedMs, remainingMs, forceToolsFirstCompletion, hasTools, toolCount, messageCount, messageSummary |
| `autogen.multi-agent: ===== AGENT TURN END =====` | info | agent, turn, durationMs, outputLength, outputPreview, transcriptLength |
| `autogen.multi-agent: ===== AGENT TURN FAILED =====` | **error** | agent, turn, durationMs, error, stack |
| `autogen.multi-agent: orchestration complete` | info | totalTurns, transcriptLength, totalDurationMs, finalAnswerLength, finalAnswerPreview |

---

### Updated: `autogen-multi-agent.ts` + `autogen-agent.ts`

Both nodes now pass `executionContext: { executionId, workflowId, nodeId }` into the tool loop and orchestrator so every log entry is correlated to the exact execution, workflow, and canvas node.

---

### How to read the logs to find the hang

**Step 1 — Find the last `===== BEFORE OPENAI CALL =====`**

This tells you exactly what was sent to OpenAI before the hang. Check:
- `messageOrder` — does it end with `tool` messages after `assistant[tool_calls:N]`?
- `last3Messages` — are `tool_call_id` values present and non-empty?
- `remainingMs` — was there enough budget left?

**Step 2 — Check if `===== TIMEOUT =====` appears**

If yes: the `roundBudgetMs` was too short for the OpenAI response latency. Increase `timeoutMs` on the node config or `loopRoundBudgetMs`.

If no `===== AFTER OPENAI CALL =====` appears after `===== BEFORE OPENAI CALL =====`: the connection hung silently — check network/proxy between Railway and OpenAI.

**Step 3 — Check `===== SENDING TOOL RESULT BACK TO OPENAI =====`**

Look for:
- `toolCallIdMatch: false` → the model returned a `tool_call_id` that doesn't match what was sent — this causes OpenAI to reject the continuation silently
- `protocolValid: false` → see `protocolViolations` array for the exact rule broken
- `payloadWarning: true` → total payload is large; consider truncating tool results

**Step 4 — Check `===== STREAM END — MAX ITERATIONS =====`**

If this appears, the model is calling tools on every turn and never returning text. Check `messageSummary.messageOrder` — if it's a repeating pattern of `assistant[tool_calls:N] → tool → assistant[tool_calls:N] → tool`, the model is stuck in a recursive loop. Fix: reduce `maxIterations`, add explicit stop instructions to the system prompt, or use `tool_choice: "auto"` instead of `"required"`.

**Step 5 — Check `===== TOOL EXECUTION END =====` for oversized results**

If `oversized: true` or `resultChars` is very large, the tool result is bloating the context window. The hard cap at 200k chars will truncate it automatically, but results over 50k chars will trigger a warning.

---

### Files changed

| File | Change |
|---|---|
| `packages/nodes-agents/src/runtime/tool-loop-debug.ts` | **New** — debug utilities: `safeJsonStringify`, `truncateLargePayload`, `summarizeMessages`, `validateToolProtocol`, `ToolLoopDebugLogger`, `buildFallbackLogger` |
| `packages/nodes-agents/src/runtime/openai-tool-loop.ts` | **Rewritten** — full deep instrumentation at every boundary |
| `packages/nodes-agents/src/runtime/autogen-orchestrator.ts` | **Updated** — per-turn logs, `executionContext` forwarded to tool loop |
| `packages/nodes-agents/src/nodes/autogen-multi-agent.ts` | **Updated** — passes `executionContext` to orchestrator |
| `packages/nodes-agents/src/nodes/autogen-agent.ts` | **Updated** — passes `executionContext` to tool loop |


---

## Production-Safe Email Implementation — Railway SMTP Hardening

Added to `packages/nodes-base/src/email.send.ts` to fix "Connection timeout" on Railway when sending email via Gmail App Password SMTP.

### Root cause on Railway

Railway containers have IPv6 enabled. Node.js 17+ returns IPv6 addresses first from DNS by default. Gmail SMTP (`smtp.gmail.com`) only reliably accepts IPv4. Without `dns.setDefaultResultOrder("ipv4first")`, `getaddrinfo` returns `2607:f8b0:...` (IPv6), the TCP connect stalls silently, and you see "Connection timeout" with no other clue.

### Required environment variables

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=<16-char Gmail App Password>
SMTP_FROM=you@gmail.com
```

`SMTP_PASS` must be a Gmail App Password — not your account password. Generate one at `myaccount.google.com/apppasswords` (requires 2FA enabled).

---

### Implementation: `packages/nodes-base/src/email.send.ts`

#### `dns.setDefaultResultOrder("ipv4first")`

Set at module load, before any DNS call. Forces `getaddrinfo` to return IPv4 addresses first. This is the single most important fix for Railway.

#### `withTimeout<T>(promise, ms, label)` — upgraded

```typescript
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId); // always clears — no dangling handles
  }
}
```

The `finally { clearTimeout }` is critical. Without it, Node.js keeps the process alive waiting for the timer even after the promise resolved, causing the worker to appear stuck after a successful send.

#### Nodemailer transporter — three explicit timeouts

```typescript
nodemailer.createTransport({
  host: smtp.host,
  port: smtp.port,
  secure: false,           // false = STARTTLS on port 587
  auth: { user, pass },
  connectionTimeout: 30_000,  // TCP socket connect
  greetingTimeout:   30_000,  // wait for "220 smtp.gmail.com" banner
  socketTimeout:     30_000,  // idle socket during DATA transfer
});
```

Each timeout covers a different sub-phase. Without all three, a stall in any sub-phase blocks forever.

#### SMTP credential resolution — env vars as fallback

Node config fields take priority; Railway env vars are the fallback:

```typescript
const host = merged.host?.trim() || process.env.SMTP_HOST?.trim() || "";
const port = merged.port || Number(process.env.SMTP_PORT) || 587;
const user = merged.authUser?.trim() || process.env.SMTP_USER?.trim() || "";
const pass = merged.authPass?.trim() || process.env.SMTP_PASS?.trim() || "";
const from = merged.from?.trim() || process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || "";
```

---

### Phase-level timing logs — 6 named phases

Every phase has a before/after log pair. The last log you see before a hang tells you exactly which phase is stuck.

| Phase | Console log | What it covers |
|---|---|---|
| 0 | `[EMAIL] ===== START =====` | Env snapshot — SMTP_HOST, SMTP_PORT, user/pass existence |
| 1 | `[EMAIL] resolving DNS` | `dns.promises.lookup()` with 10s timeout |
| 2 | `[EMAIL] creating transporter` | Nodemailer config (synchronous) |
| 3 | `[EMAIL] before verify` | TCP connect + EHLO + STARTTLS + AUTH LOGIN |
| 4 | *(mail options build)* | Body + attachment serialization |
| 5 | `[EMAIL] before sendMail` | DATA transfer to SMTP server |
| 6 | `[EMAIL] TOTAL COMPLETED IN` | Result serialization + return |

#### Phase 1 — DNS pre-resolution

```typescript
const result = await withTimeout(
  dns.promises.lookup(smtp.host),
  10_000,
  `dns.lookup(${smtp.host})`,
);
console.log("[EMAIL] DNS resolved in", Date.now() - dnsStart, "ms");
console.log("[EMAIL] DNS address", result.address, "family", result.family);
```

Runs before Nodemailer touches the network. Logs the resolved IP and address family. If `family === 6` (IPv6), a warning fires — that is the hang cause.

#### Phase 3 — SMTP verify

```typescript
await withTimeout(transporter.verify(), 30_000, "smtp verify");
```

Opens a real TCP connection, completes `EHLO` + `AUTH LOGIN`, then closes. Tests all four sub-phases: TCP connect, SMTP greeting, TLS negotiation, authentication. If this fails, the error message identifies which sub-phase:

| Error message | Sub-phase | Cause |
|---|---|---|
| `smtp verify timeout after 30000ms` | TCP connect or greeting | Port 587 blocked or TLS mismatch |
| `535 Authentication failed` | AUTH | Wrong App Password |
| `ECONNREFUSED` | TCP connect | Wrong host/port |
| `certificate` / `TLS` | TLS handshake | `secure` flag mismatch |
| `greeting timeout` | SMTP banner | Connected but no `220` response |

#### Phase 5 — sendMail with `withTimeout`

```typescript
info = await withTimeout(
  transporter.sendMail(mailOptions),
  30_000,
  "sendMail",
);
```

Hard wall-clock cap on the entire DATA transfer. Nodemailer's `socketTimeout` should fire first, but `withTimeout` is the safety net for cases where Nodemailer's internal timer doesn't reject cleanly.

---

### Tool-level wrapper logs

```
[TOOL] send_client_email START
...
[TOOL] send_client_email END 4318 ms
```

Brackets the entire node execution including config parsing, so you can see total tool time vs SMTP time in Railway logs.

---

### Structured return values

**Success:**
```typescript
return {
  success: true,
  messageId: info.messageId,
  accepted: info.accepted,
  rejected: info.rejected,
  response: info.response,
  durationMs: totalDurationMs,
};
```

**Error (caught — never hangs):**
```typescript
return {
  success: false,
  error: error instanceof Error ? error.message : String(error),
  accepted: [],
  rejected: [],
  durationMs: Date.now() - started,
};
```

Errors return structured JSON instead of throwing, so the workflow engine receives the node output and the agent can read `success: false` to decide what to do next, rather than the entire workflow crashing.

---

### Structured error log on failure

```typescript
console.error("[EMAIL] ERROR");
console.error({
  message: error instanceof Error ? error.message : String(error),
  stack:   error instanceof Error ? error.stack : undefined,
  timestamp: new Date().toISOString(),
  durationMs: Date.now() - started,
});
```

Full stack trace always logged. The `durationMs` tells you how long the node ran before failing — if it's ~30000ms, a timeout fired; if it's <1000ms, it was a config/auth error.

---

### Reading Railway logs to find the exact hang

**Successful send — full log sequence:**
```
[TOOL] send_client_email START
[EMAIL] ===== START =====
[EMAIL] timestamp 2026-05-19T12:00:00.000Z
[EMAIL] SMTP_HOST smtp.gmail.com
[EMAIL] SMTP_PORT 587
[EMAIL] SMTP_USER exists true
[EMAIL] SMTP_PASS exists true
[EMAIL] resolving DNS
[EMAIL] DNS resolved in 45 ms
[EMAIL] DNS address 142.250.x.x family 4
[EMAIL] creating transporter
[EMAIL] transporter created
[EMAIL] before verify
[EMAIL] verify completed in 1823 ms
[EMAIL] before sendMail
[EMAIL] sendMail completed in 2341 ms
[EMAIL] messageId <abc@smtp.gmail.com>
[EMAIL] TOTAL COMPLETED IN 4312 ms
[EMAIL] ===== END =====
[TOOL] send_client_email END 4318 ms
```

**IPv6 hang — what you see:**
```
[EMAIL] resolving DNS
[EMAIL] DNS resolved in 52 ms
[EMAIL] DNS address 2607:f8b0:... family 6   ← IPv6 returned
[EMAIL] WARNING: IPv6 address returned...
[EMAIL] creating transporter
[EMAIL] transporter created
[EMAIL] before verify
                                              ← hangs 30s here
[EMAIL] verify FAILED
{ message: "smtp verify timeout after 30000ms", phase: "SMTP_VERIFY" }
```

Fix: confirm `dns.setDefaultResultOrder("ipv4first")` runs before any import that triggers DNS. Move it to the top of the file, before all other imports if needed.

**Wrong App Password — what you see:**
```
[EMAIL] before verify
[EMAIL] verify FAILED
{ message: "535-5.7.8 Username and Password not accepted", phase: "SMTP_VERIFY" }
```

Fix: regenerate the App Password at `myaccount.google.com/apppasswords`. Remove spaces from the 16-character code.

**Port blocked — what you see:**
```
[EMAIL] DNS resolved in 48 ms
[EMAIL] DNS address 142.250.x.x family 4     ← IPv4, DNS is fine
[EMAIL] before verify
                                              ← hangs 30s
[EMAIL] verify FAILED
{ message: "smtp verify timeout after 30000ms", phase: "SMTP_VERIFY" }
```

DNS resolved correctly but verify still timed out — port 587 is blocked by Railway egress firewall. Check Railway project network settings for outbound port 587.

---

### `diagnoseSMTPError()` — automatic diagnosis

Every error catch calls `diagnoseSMTPError(message, phase)` which maps error strings to actionable fixes:

| Error pattern | Diagnosis |
|---|---|
| `timeout` + verify phase | IPv6 / port 587 blocked / wrong host |
| `timeout` + sendMail phase | Large payload / socketTimeout / network congestion |
| `ECONNREFUSED` | Wrong host:port combination |
| `ENOTFOUND` / `getaddrinfo` | DNS cannot resolve SMTP_HOST |
| `ETIMEDOUT` | Host reachable but port not responding |
| `535` / `authentication` | Wrong App Password |
| `534` / `less secure` | Account password used instead of App Password |
| `550` / `relay` | Recipient rejected by server |
| `certificate` / `TLS` | `secure` flag mismatch (587→false, 465→true) |
| `greeting` | Connected but no `220` banner — wrong port or TLS mismatch |

---

### Files changed

| File | Change |
|---|---|
| `packages/nodes-base/src/email.send.ts` | Full rewrite of `execute()` with 6-phase instrumentation, upgraded `withTimeout`, DNS pre-resolution, structured success/error returns, tool-level wrapper logs, `diagnoseSMTPError()` helper |

---

## Deep Phase Diagnostics Extension

Extended the email implementation with explicit per-await timing and the exact log lines required for Railway production debugging.

### Additional exact log lines added

```typescript
// Phase 0 — env snapshot
console.log("[EMAIL] ===== START =====");
console.log("[EMAIL] timestamp", new Date().toISOString());
console.log("[EMAIL] SMTP_HOST", process.env.SMTP_HOST);
console.log("[EMAIL] SMTP_PORT", process.env.SMTP_PORT);
console.log("[EMAIL] SMTP_USER exists", !!process.env.SMTP_USER);
console.log("[EMAIL] SMTP_PASS exists", !!process.env.SMTP_PASS);

// Phase 1 — DNS
console.log("[EMAIL] resolving DNS");
console.log("[EMAIL] DNS resolved in", Date.now() - dnsStart, "ms");

// Phase 2 — transporter
console.log("[EMAIL] creating transporter");
console.log("[EMAIL] transporter created");

// Phase 3 — verify
console.log("[EMAIL] before verify");
console.log("[EMAIL] verify completed in", Date.now() - verifyStart, "ms");

// Phase 5 — sendMail
console.log("[EMAIL] before sendMail");
console.log("[EMAIL] sendMail completed in", Date.now() - sendStart, "ms");
console.log("[EMAIL] messageId", info.messageId);
console.log("[EMAIL] TOTAL COMPLETED IN", Date.now() - started, "ms");
console.log("[EMAIL] ===== END =====");

// Tool wrapper
console.log("[TOOL] send_client_email START");
console.log("[TOOL] send_client_email END", Date.now() - toolStart, "ms");
```

### Payload size check (Phase 4)

```typescript
const serializedSize = JSON.stringify(mailOptions).length;
// Warns if > 500,000 chars — may hit socketTimeout during DATA phase
```

### Where each timeout fires

| Timeout | Fires when | Nodemailer internal or withTimeout |
|---|---|---|
| `connectionTimeout: 30000` | TCP socket connect stalls | Nodemailer internal |
| `greetingTimeout: 30000` | No `220` banner after connect | Nodemailer internal |
| `socketTimeout: 30000` | Idle socket during DATA | Nodemailer internal |
| `withTimeout(verify, 30000)` | verify() doesn't reject cleanly | Hard wall-clock cap |
| `withTimeout(sendMail, 30000)` | sendMail() doesn't reject cleanly | Hard wall-clock cap |
| `withTimeout(dns.lookup, 10000)` | DNS resolution stalls | Hard wall-clock cap |

Nodemailer's internal timeouts fire first in normal cases. `withTimeout` is the safety net for cases where Nodemailer's internal timer doesn't reject cleanly (observed on some Railway proxy configurations).
