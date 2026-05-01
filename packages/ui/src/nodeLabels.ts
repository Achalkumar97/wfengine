import type { WfNodeData } from "./exportWorkflow.js";
import { getConfigPreviewLine } from "./configPreview.js";

/** Premium Studio card title — human labels; triggers get a “Trigger” suffix. */
export function studioNodeTitle(wfType: string, label: string): string {
  const base = label.trim();
  if (wfType.startsWith("trigger.")) {
    if (/trigger$/i.test(base)) return base;
    return `${base} Trigger`;
  }
  return base || wfType;
}

const TITLE_OVERRIDE: Record<string, string> = {
  "http.request": "httpRequest",
  "file.read": "readFile",
  "file.write": "writeFile",
};

/** Compact technical title (legacy / exports). */
export function turboNodeTitle(wfType: string, label: string): string {
  const o = TITLE_OVERRIDE[wfType];
  if (o) return o;
  if (wfType.startsWith("trigger.")) {
    const rest = wfType.slice("trigger.".length);
    const segs = rest.split(".");
    return segs
      .map((s, i) =>
        i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1),
      )
      .join("");
  }
  const parts = wfType.split(".");
  if (parts.length === 2) {
    const a = parts[0] ?? "";
    const b = parts[1] ?? "";
    return `${b}${a.charAt(0).toUpperCase()}${a.slice(1)}`;
  }
  const fromLabel = label.replace(/\s+/g, "");
  return fromLabel || wfType.replace(/\./g, "_");
}

/** Gray subtitle — filename fragment, URL hint, or compact type */
export function turboNodeSubtitle(data: WfNodeData): string {
  const preview = getConfigPreviewLine(data);
  if (preview) {
    if (
      (data.wfType === "file.read" || data.wfType === "file.write") &&
      (preview.includes("/") || preview.includes("\\"))
    ) {
      const seg =
        preview.split(/[/\\]/).pop()?.trim() ?? preview;
      return seg.length > 36 ? `${seg.slice(0, 34)}…` : seg;
    }
    if (preview.includes(".")) {
      return preview.length > 40 ? `${preview.slice(0, 38)}…` : preview;
    }
    return preview.length > 40 ? `${preview.slice(0, 38)}…` : preview;
  }
  return data.wfType.replace(/^trigger\./, "").replace(/\./g, " · ");
}
