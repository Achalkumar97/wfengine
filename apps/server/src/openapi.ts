/**
 * OpenAPI document for Swagger UI (`/api-docs`).
 * Kept in sync manually with route handlers under `routes/`.
 */
/** Exported mutable document for `@fastify/swagger` (avoid `as const` — Swagger types expect mutable arrays). */
export const openApiRoot: Record<string, unknown> = {
  openapi: "3.1.0",
  info: {
    title: "wfengine API",
    description:
      "REST API for workflows, versions, executions, inbound webhooks, and cron. " +
      "When `API_KEY` is set, send header `x-api-key` on protected routes (not required for `/health`, `/hooks/*`, or documentation).",
    version: "0.1.0",
  },
  tags: [
    { name: "Meta", description: "Health and docs" },
    { name: "Workflows", description: "Workflow containers and versioned definitions" },
    { name: "Executions", description: "Run workflow versions" },
    { name: "Hooks", description: "Inbound triggers (public when API key is enabled)" },
    { name: "Cron", description: "Scheduled runs via BullMQ + Redis" },
  ],
  components: {
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
      },
      WorkflowDefinition: {
        type: "object",
        description: "DAG: id, nodes[], edges[] — see @wfengine/shared workflow schema",
        additionalProperties: true,
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Meta"],
        summary: "Liveness probe",
        security: [],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { ok: { type: "boolean", enum: [true] } },
                },
              },
            },
          },
        },
      },
    },
    "/workflows": {
      get: {
        tags: ["Workflows"],
        summary: "List workflows (latest version only)",
        security: [{ apiKey: [] }],
        responses: {
          "200": { description: "Workflows" },
          "401": { description: "Unauthorized" },
        },
      },
      post: {
        tags: ["Workflows"],
        summary: "Create workflow container",
        security: [{ apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  meta: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
          "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/workflows/{id}": {
      get: {
        tags: ["Workflows"],
        summary: "Get workflow and versions",
        security: [{ apiKey: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Workflow with versions" },
          "401": { description: "Unauthorized" },
          "404": { description: "Not found" },
        },
      },
    },
    "/workflows/{id}/versions": {
      post: {
        tags: ["Workflows"],
        summary: "Append immutable workflow version",
        security: [{ apiKey: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["definition"],
                properties: {
                  definition: { $ref: "#/components/schemas/WorkflowDefinition" },
                  label: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Version created" },
          "401": { description: "Unauthorized" },
          "404": { description: "Workflow not found" },
        },
      },
    },
    "/workflow-versions/{versionId}": {
      get: {
        tags: ["Workflows"],
        summary: "Get one workflow version",
        security: [{ apiKey: [] }],
        parameters: [
          {
            name: "versionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Workflow version" },
          "401": { description: "Unauthorized" },
          "404": { description: "Not found" },
        },
      },
    },
    "/executions": {
      post: {
        tags: ["Executions"],
        summary: "Start execution (sync or async)",
        security: [{ apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["workflowVersionId"],
                properties: {
                  workflowVersionId: { type: "string", format: "uuid" },
                  initialData: {},
                  async: { type: "boolean", description: "If true, queue job (HTTP 202)" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Completed sync run" },
          "202": { description: "Queued async run" },
          "401": { description: "Unauthorized" },
          "404": { description: "Workflow version not found" },
        },
      },
    },
    "/executions/{id}": {
      get: {
        tags: ["Executions"],
        summary: "Get execution status and result",
        security: [{ apiKey: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Execution" },
          "401": { description: "Unauthorized" },
          "404": { description: "Not found" },
        },
      },
    },
    "/hooks/by-version/{versionId}": {
      post: {
        tags: ["Hooks"],
        summary: "Webhook trigger — body becomes initialData",
        description:
          "Does not use `x-api-key` when global API key protection is enabled. Optional query `async=true` to queue.",
        security: [],
        parameters: [
          {
            name: "versionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "async",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["1", "true"] },
          },
        ],
        requestBody: {
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        responses: {
          "200": { description: "Sync execution finished" },
          "202": { description: "Async queued" },
          "404": { description: "Workflow version not found" },
        },
      },
    },
    "/workflow-versions/{versionId}/cron": {
      post: {
        tags: ["Cron"],
        summary: "Register repeatable cron job (BullMQ)",
        security: [{ apiKey: [] }],
        parameters: [
          {
            name: "versionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["expression"],
                properties: {
                  expression: {
                    type: "string",
                    description: "Cron expression validated by node-cron",
                    example: "0 * * * *",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Registered" },
          "400": { description: "Invalid cron expression" },
          "401": { description: "Unauthorized" },
          "404": { description: "Workflow version not found" },
        },
      },
      delete: {
        tags: ["Cron"],
        summary: "Remove repeatable cron job",
        security: [{ apiKey: [] }],
        parameters: [
          {
            name: "versionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Attempted removal; body includes removed flag" },
          "401": { description: "Unauthorized" },
        },
      },
    },
  },
};
