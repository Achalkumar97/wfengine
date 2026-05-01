import type { WorkflowExecuteResult } from "@wfengine/core";
import { topologicalSort, type WorkflowDefinition } from "@wfengine/shared";
import { cn } from "@wfengine/ui";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { toast } from "sonner";

export type LiveRunStep = {
  nodeId: string;
  nodeType: string;
  status: "pending" | "running" | "ok" | "failed";
  error?: string;
};

export interface RunInspectorPanelProps {
  runResult: WorkflowExecuteResult | null;
  runError: string | null;
  workflowDefinition?: WorkflowDefinition | null;
  /** While the workflow executes, per-node status in topological order */
  liveSteps?: LiveRunStep[] | null;
  /** True during POST /runs/inline/stream */
  runBusy?: boolean;
  onClear?: () => void;
  onOpenModal?: () => void;
}

function wfTypeForNodeId(
  def: WorkflowDefinition | null | undefined,
  nodeId: string,
): string | null {
  if (!def?.nodes) return null;
  const n = def.nodes.find((x) => x.id === nodeId);
  return n?.type ?? null;
}

/** Fallback when the graph cannot be sorted (e.g. invalid/cyclic saved state). */
function orderNodeIdsByDefinitionIndex(
  def: WorkflowDefinition | null | undefined,
  ids: string[],
): string[] {
  if (!def?.nodes?.length) return [...ids].sort((a, b) => a.localeCompare(b));
  const index = new Map(def.nodes.map((n, i) => [n.id, i]));
  return [...ids].sort((a, b) => {
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a.localeCompare(b);
  });
}

/** Same order the engine uses: topological (respects edges), not canvas JSON node order. */
function orderNodeIdsByExecution(
  def: WorkflowDefinition | null | undefined,
  ids: string[],
): string[] {
  if (!def?.nodes?.length) return [...ids].sort((a, b) => a.localeCompare(b));
  try {
    const fullOrder = topologicalSort(def);
    const idSet = new Set(ids);
    const ordered = fullOrder.filter((id) => idSet.has(id));
    const seen = new Set(ordered);
    const orphan = [...ids]
      .filter((id) => !seen.has(id))
      .sort((a, b) => a.localeCompare(b));
    return [...ordered, ...orphan];
  } catch {
    return orderNodeIdsByDefinitionIndex(def, ids);
  }
}

export function RunInspectorPanel(props: RunInspectorPanelProps): ReactElement {
  const {
    runResult,
    runError,
    workflowDefinition,
    liveSteps,
    runBusy,
    onClear,
    onOpenModal,
  } = props;
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const nodeIds = useMemo(() => {
    if (!runResult) return [];
    const out = Object.keys(runResult.outputs ?? {});
    const err = Object.keys(runResult.errors ?? {});
    const set = new Set([...out, ...err]);
    return orderNodeIdsByExecution(workflowDefinition ?? null, [...set]);
  }, [runResult, workflowDefinition]);

  const toggleOpen = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const copyFullJson = useCallback(() => {
    if (!runResult) return;
    void navigator.clipboard.writeText(JSON.stringify(runResult, null, 2));
    toast.success("Copied run result JSON");
  }, [runResult]);

  const statusBadge =
    runResult?.status === "completed"
      ? "bg-emerald-500/20 text-emerald-300 ring-emerald-400/35"
      : runResult?.status === "failed"
        ? "bg-rose-500/25 text-rose-200 ring-rose-400/40"
        : runResult?.status === "partial"
          ? "bg-amber-500/20 text-amber-200 ring-amber-400/35"
          : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {runBusy ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-200 ring-1 ring-violet-400/35">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            running
          </span>
        ) : null}
        {runResult ? (
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1",
              statusBadge || "bg-zinc-500/20 text-zinc-300 ring-zinc-500/40",
            )}
          >
            {runResult.status}
          </span>
        ) : runError ? (
          <span className="rounded-md bg-rose-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-200 ring-1 ring-rose-400/40">
            http error
          </span>
        ) : !runBusy ? (
          <span className="text-[12px] text-zinc-500">
            No run yet — use Run in the toolbar.
          </span>
        ) : null}
        {runResult ? (
          <button
            type="button"
            onClick={copyFullJson}
            className="rounded-lg border border-white/[0.1] bg-[#1a1a22] px-2 py-1 text-[11px] text-zinc-300 hover:border-white/[0.16]"
          >
            Copy JSON
          </button>
        ) : null}
        {onOpenModal ? (
          <button
            type="button"
            onClick={onOpenModal}
            className="rounded-lg border border-white/[0.1] bg-[#1a1a22] px-2 py-1 text-[11px] text-zinc-300 hover:border-white/[0.16]"
          >
            Open in window
          </button>
        ) : null}
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-white/[0.1] bg-[#1a1a22] px-2 py-1 text-[11px] text-zinc-400 hover:border-white/[0.16]"
          >
            Clear
          </button>
        ) : null}
      </div>

      {runError ? (
        <div className="rounded-lg border border-rose-500/35 bg-rose-950/30 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
          {runError}
        </div>
      ) : null}

      {liveSteps && liveSteps.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            Live progress
          </p>
          <ul className="space-y-1.5">
            {liveSteps.map((row) => (
              <li
                key={row.nodeId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-[#16161f] px-3 py-2 text-[11px]"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-zinc-200">
                  {row.nodeId}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                  {row.nodeType}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  {row.status === "running" ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin text-violet-400"
                      aria-hidden
                    />
                  ) : null}
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                      row.status === "pending" &&
                        "bg-zinc-600/25 text-zinc-400",
                      row.status === "running" &&
                        "bg-violet-500/20 text-violet-200",
                      row.status === "ok" &&
                        "bg-emerald-500/20 text-emerald-300",
                      row.status === "failed" &&
                        "bg-rose-500/25 text-rose-200",
                    )}
                  >
                    {row.status}
                  </span>
                </span>
                {row.status === "failed" && row.error ? (
                  <pre className="mt-1 w-full max-h-[72px] overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 font-mono text-[10px] text-rose-100/90">
                    {row.error}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {runResult ? (
        <div className="space-y-2 rounded-lg border border-white/[0.06] bg-[#16161f] px-3 py-2 text-[11px] text-zinc-400">
          <p className="font-mono text-zinc-300">
            executionId: {runResult.executionId}
          </p>
          <p className="font-mono text-zinc-300">
            workflowId: {runResult.workflowId}
          </p>
          <p>
            startedAt: {runResult.startedAt}
            <br />
            finishedAt: {runResult.finishedAt}
          </p>
        </div>
      ) : null}

      {runResult && nodeIds.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            Nodes
          </p>
          <ul className="space-y-2">
            {nodeIds.map((nodeId) => {
              const wfType =
                wfTypeForNodeId(workflowDefinition ?? null, nodeId) ?? "—";
              const err = runResult.errors[nodeId];
              const out = runResult.outputs[nodeId];
              const failed = Boolean(err);
              const expanded = openIds.has(nodeId);

              return (
                <li
                  key={nodeId}
                  className="overflow-hidden rounded-lg border border-white/[0.06] bg-[#1a1a22]"
                >
                  <button
                    type="button"
                    onClick={() => toggleOpen(nodeId)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-white/[0.03]"
                  >
                    <span className="mt-0.5 shrink-0 text-zinc-500">
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-[12px] text-zinc-200">
                          {nodeId}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                            failed
                              ? "bg-rose-500/25 text-rose-200"
                              : "bg-emerald-500/20 text-emerald-300",
                          )}
                        >
                          {failed ? "failed" : "ok"}
                        </span>
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-zinc-500">
                        {wfType}
                      </span>
                    </span>
                  </button>
                  {expanded ? (
                    <div className="border-t border-white/[0.06] px-3 pb-3 pt-2">
                      {failed ? (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase text-rose-400/90">
                            Error
                          </p>
                          <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 font-mono text-[11px] text-rose-100/95">
                            {err}
                          </pre>
                        </div>
                      ) : null}
                      {out !== undefined ? (
                        <div className={failed ? "mt-3" : ""}>
                          <p className="mb-1 text-[10px] font-semibold uppercase text-zinc-500">
                            Output
                          </p>
                          <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 font-mono text-[11px] text-zinc-300">
                            {typeof out === "string"
                              ? out
                              : JSON.stringify(out, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : runResult && nodeIds.length === 0 ? (
        <p className="text-[12px] text-zinc-500">No node outputs in result.</p>
      ) : null}
    </div>
  );
}
