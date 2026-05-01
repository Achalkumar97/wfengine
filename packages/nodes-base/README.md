# @wfengine/nodes-base

Built-in workflow nodes. Install this package only if you need these integrations; otherwise use `@wfengine/core` and register your own nodes.

## Nodes

| Type | Description | Extra npm deps (bundled here) |
|------|-------------|--------------------------------|
| `noop` | Pass-through | — |
| `http.request` | HTTP client | — (fetch) |
| `trigger.webhook` | Entry + `createWebhookHandler` | — |
| `trigger.cron` | Cron + `scheduleWorkflowCron` | `node-cron` |
| `email.send` | SMTP | `nodemailer` |
| `email.read` | IMAP | `imapflow` |
| `slack.send` | `chat.postMessage` | `@slack/web-api` |
| `postgres.query` | SQL | `pg` |
| `file.read` / `file.write` | Files under `baseDir` | — |

Zod **`ConfigSchema`** / **`OutputSchema`** values live in **`@wfengine/nodes-base/config-schemas`** (Zod only, no Node I/O) so browser tools (e.g. Studio) can import them without bundling `pg`, `imapflow`, etc. The package root still re-exports the same symbols for Node usage.

## Usage

```typescript
import { WorkflowEngine } from "@wfengine/core";
import { registerBuiltinNodes } from "@wfengine/nodes-base";

const engine = new WorkflowEngine();
registerBuiltinNodes(engine);
```

Or register only what you need:

```typescript
import { emailReadNode, emailSendNode } from "@wfengine/nodes-base";

engine.registerNode(emailReadNode);
engine.registerNode(emailSendNode);
```

Credentials belong in workflow `node.config` JSON or env-backed wrappers you provide—never commit secrets.
