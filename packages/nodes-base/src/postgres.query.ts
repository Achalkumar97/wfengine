import type { NodeDefinition } from "@wfengine/core";
import pg from "pg";
import { z } from "zod";
import {
  PostgresQueryConfigSchema,
  PostgresQueryOutputSchema,
} from "./config-schemas.js";
import { redactSecretsDeep } from "./redact-secrets.js";

export {
  PostgresQueryConfigSchema,
  PostgresQueryOutputSchema,
} from "./config-schemas.js";

export type PostgresQueryConfig = z.infer<typeof PostgresQueryConfigSchema>;

export const postgresQueryNode: NodeDefinition = {
  type: "postgres.query",
  label: "PostgreSQL query",
  category: "action",
  description:
    "Run a single SQL statement via node-postgres (`pg`). Use params for values to avoid injection.",
  configSchema:
    PostgresQueryConfigSchema as unknown as z.ZodType<Record<string, unknown>>,
  outputSchema:
    PostgresQueryOutputSchema as unknown as z.ZodType<Record<string, unknown>>,
  execute: async ({ config, context }) => {
    const c = PostgresQueryConfigSchema.parse(config);
    const pool = new pg.Pool({
      connectionString: c.connectionString,
      max: 1,
    });

    try {
      context.logger.debug("postgres.query executing");
      const result = await pool.query(c.query, c.params);
      const rows = (result.rows as Record<string, unknown>[]).map((row) =>
        redactSecretsDeep(row) as Record<string, unknown>,
      );
      return {
        rows,
        rowCount: result.rowCount,
        fields: result.fields?.map((f) => ({ name: f.name })),
      };
    } finally {
      await pool.end();
    }
  },
};
