/**
 * Replace `{{key}}`, `{{a.b.c}}`, and simple `[Human Label]` placeholders
 * using values from a flat-ish object.
 */
export function interpolateTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  return template
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, pathRaw: string) => {
      const val = lookupPath(data, pathRaw.trim());
      return formatPlaceholderValue(val);
    })
    .replace(/\[([A-Za-z][A-Za-z0-9 _.-]{1,80})\]/g, (match, labelRaw: string) => {
      const val = lookupPath(data, labelRaw.trim());
      return val === undefined || val === null ? match : formatPlaceholderValue(val);
    });
}

export function interpolateTemplateTwice(
  template: string,
  data: Record<string, unknown>,
): string {
  return interpolateTemplate(interpolateTemplate(template, data), data);
}

export function interpolateTemplateValue<T>(
  value: T,
  data: Record<string, unknown>,
): T {
  if (typeof value === "string") {
    return interpolateTemplateTwice(value, data) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateTemplateValue(item, data)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = interpolateTemplateValue(child, data);
    }
    return out as T;
  }
  return value;
}

function lookupPath(root: Record<string, unknown>, pathStr: string): unknown {
  if (!pathStr.includes(".")) {
    return lookupObjectKey(root, pathStr);
  }
  const parts = pathStr.split(".");
  let cur: unknown = root;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = lookupObjectKey(cur as Record<string, unknown>, p);
  }
  return cur;
}

function lookupObjectKey(obj: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];

  const normalizedWanted = normalizeKey(key);
  for (const [candidate, value] of Object.entries(obj)) {
    if (normalizeKey(candidate) === normalizedWanted) return value;
  }
  return undefined;
}

function normalizeKey(key: string): string {
  const parts = key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts.map((p) => p.toLowerCase()).join("");
}

function formatPlaceholderValue(val: unknown): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "bigint") return val.toString();
  try {
    const s = JSON.stringify(val);
    return s.length > 4000 ? `${s.slice(0, 3997)}...` : s;
  } catch {
    return String(val);
  }
}
