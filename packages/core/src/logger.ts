import type { WorkflowLogger } from "./node.types.js";

function bindingsPrefix(b: Record<string, unknown>): string {
  const parts = Object.entries(b).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return parts.length ? `[${parts.join(" ")}] ` : "";
}

export function createConsoleLogger(
  bindings: Record<string, unknown> = {},
): WorkflowLogger {
  const prefix = bindingsPrefix(bindings);

  return {
    debug(msg, meta) {
      if (meta) console.debug(prefix + msg, meta);
      else console.debug(prefix + msg);
    },
    info(msg, meta) {
      if (meta) console.info(prefix + msg, meta);
      else console.info(prefix + msg);
    },
    warn(msg, meta) {
      if (meta) console.warn(prefix + msg, meta);
      else console.warn(prefix + msg);
    },
    error(msg, meta) {
      if (meta) console.error(prefix + msg, meta);
      else console.error(prefix + msg);
    },
    child(extra: Record<string, unknown>): WorkflowLogger {
      return createConsoleLogger({ ...bindings, ...extra });
    },
  };
}
