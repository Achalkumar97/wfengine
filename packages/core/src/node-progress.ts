import type { NodeProgressEvent } from "./node.types.js";

type OnProgress = (event: NodeProgressEvent) => void;

/** Fires `phase: "start"` if a listener is configured. */
export function emitNodeStart(
  onProgress: OnProgress | undefined,
  nodeId: string,
  nodeType: string,
): void {
  onProgress?.({ phase: "start", nodeId, nodeType });
}

export function emitNodeComplete(
  onProgress: OnProgress | undefined,
  args: {
    nodeId: string;
    nodeType: string;
    ok: boolean;
    error?: string;
  },
): void {
  if (!onProgress) return;
  const ev: NodeProgressEvent = {
    phase: "complete",
    nodeId: args.nodeId,
    nodeType: args.nodeType,
    ok: args.ok,
  };
  if (args.error !== undefined) {
    ev.error = args.error;
  }
  onProgress(ev);
}
