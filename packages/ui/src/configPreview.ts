import type { WfNodeData } from "./exportWorkflow.js";

/** One-line preview of config on the node card */
export function getConfigPreviewLine(data: WfNodeData): string | null {
  const { wfType, config } = data;
  switch (wfType) {
    case "http.request": {
      const methodRaw =
        typeof config.method === "string" ? config.method : "GET";
      const method = methodRaw.toUpperCase();
      const urlStr = typeof config.url === "string" ? config.url.trim() : "";
      if (!urlStr) {
        return method !== "GET" ? method : null;
      }
      try {
        const u = new URL(urlStr);
        const path = `${u.pathname}${u.search}` || "/";
        return `${method} ${path}`;
      } catch {
        return `${method} ${urlStr}`;
      }
    }
    case "trigger.cron":
      return typeof config.expression === "string" ? config.expression : null;
    case "email.send":
      return typeof config.subject === "string" ? config.subject : null;
    case "slack.send":
      return typeof config.channel === "string" ? `#${config.channel}` : null;
    case "postgres.query": {
      if (typeof config.query !== "string") return null;
      const q = config.query.replace(/\s+/g, " ").trim();
      return q.length > 48 ? `${q.slice(0, 46)}…` : q;
    }
    case "file.read":
    case "file.write":
      return typeof config.path === "string" ? config.path : null;
    case "github.repo.list-branches":
    case "github.repo.analyze":
    case "github.repo.generate-tests-llm":
    case "github.repo.run-tests": {
      const o =
        typeof config.owner === "string" ? config.owner.trim() : "";
      const r = typeof config.repo === "string" ? config.repo.trim() : "";
      if (!o && !r) return null;
      const refRaw = typeof config.ref === "string" ? config.ref.trim() : "";
      const ref = refRaw || "main";
      const suffix =
        wfType === "github.repo.run-tests" &&
        typeof config.testCommand === "string" &&
        config.testCommand.trim()
          ? ` · ${config.testCommand.trim()}`
          : "";
      const llmSuffix =
        wfType === "github.repo.generate-tests-llm" &&
        typeof config.model === "string" &&
        config.model.trim()
          ? ` · ${config.model.trim()}`
          : "";
      if (wfType === "github.repo.list-branches") {
        return o || r ? `${o}/${r}` : null;
      }
      return `${o}/${r}@${ref}${suffix}${llmSuffix}`;
    }
    default:
      return null;
  }
}

export function isTriggerType(wfType: string): boolean {
  return wfType.startsWith("trigger.");
}
