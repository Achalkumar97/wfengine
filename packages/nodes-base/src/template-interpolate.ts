/**
 * Replace `{{key}}` and `{{a.b.c}}` placeholders using values from a flat-ish
 * record (nested paths walk plain objects).
 */
export function interpolateTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, pathRaw: string) => {
    const val = lookupPath(data, pathRaw.trim());
    return formatPlaceholderValue(val);
  });
}

function lookupPath(root: Record<string, unknown>, pathStr: string): unknown {
  if (!pathStr.includes(".")) {
    return root[pathStr];
  }
  const parts = pathStr.split(".");
  let cur: unknown = root;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function formatPlaceholderValue(val: unknown): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "bigint") return val.toString();
  try {
    const s = JSON.stringify(val);
    return s.length > 4000 ? `${s.slice(0, 3997)}…` : s;
  } catch {
    return String(val);
  }
}
