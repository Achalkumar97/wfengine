/**
 * ExecutionProgressPanel — live async execution progress UI.
 *
 * Shows:
 *   - Execution phase badge (queued / running / completed / failed)
 *   - Progress bar (percent complete)
 *   - Current node / agent
 *   - Per-node live status list
 *   - Cancel button
 *   - Final result summary on completion
 */
import { cn } from "@wfengine/ui";
import { Loader2, X, CheckCircle2, XCircle, Clock } from "lucide-react";
import type { ReactElement } from "react";
import type { AsyncRunState } from "./useAsyncRun.js";
import type { LiveRunStep } from "./RunInspectorPanel.js";

interface ExecutionProgressPanelProps {
  state: AsyncRunState;
  liveSteps: LiveRunStep[];
  onCancel?: () => void;
  onClear?: () => void;
}

function PhaseBadge({ phase }: { phase: AsyncRunState["phase"] }): ReactElement {
  const map: Record<
    AsyncRunState["phase"],
    { label: string; className: string; icon?: ReactElement }
  > = {
    idle: {
      label: "idle",
      className: "bg-zinc-600/25 text-zinc-400 ring-zinc-500/30",
    },
    queued: {
      label: "queued",
      className: "bg-amber-500/20 text-amber-200 ring-amber-400/35",
      icon: <Clock className="h-3 w-3" aria-hidden />,
    },
    running: {
      label: "running",
      className: "bg-violet-500/20 text-violet-200 ring-violet-400/35",
      icon: <Loader2 className="h-3 w-3 animate-spin" aria-hidden />,
    },
    completed: {
      label: "completed",
      className: "bg-emerald-500/20 text-emerald-300 ring-emerald-400/35",
      icon: <CheckCircle2 className="h-3 w-3" aria-hidden />,
    },
    failed: {
      label: "failed",
      className: "bg-rose-500/25 text-rose-200 ring-rose-400/40",
      icon: <XCircle className="h-3 w-3" aria-hidden />,
    },
    cancelled: {
      label: "cancelled",
      className: "bg-zinc-500/25 text-zinc-300 ring-zinc-400/35",
      icon: <X className="h-3 w-3" aria-hidden />,
    },
  };

  const { label, className, icon } = map[phase];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1",
        className,
      )}
    >
      {icon}
      {label}
    </span>
  );
}

export function ExecutionProgressPanel({
  state,
  liveSteps,
  onCancel,
  onClear,
}: ExecutionProgressPanelProps): ReactElement {
  const isActive = state.phase === "queued" || state.phase === "running";
  const isTerminal =
    state.phase === "completed" ||
    state.phase === "failed" ||
    state.phase === "cancelled";

  const progressPercent =
    state.phase === "running" && "progressPercent" in state
      ? (state.progressPercent ?? 0)
      : state.phase === "completed"
        ? 100
        : 0;

  const executionId =
    state.phase !== "idle" ? state.executionId : null;

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <PhaseBadge phase={state.phase} />

        {executionId ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">
            {executionId}
          </span>
        ) : (
          <span className="text-[12px] text-zinc-500">
            No async run yet — use Run (Async) in the toolbar.
          </span>
        )}

        {isActive && onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-lg border border-rose-500/30 bg-rose-950/30 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:border-rose-400/45"
          >
            Cancel
          </button>
        ) : null}

        {isTerminal && onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 rounded-lg border border-white/[0.1] bg-[#1a1a22] px-2 py-1 text-[11px] text-zinc-400 hover:border-white/[0.16]"
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* Progress bar */}
      {(isActive || state.phase === "completed") && progressPercent > 0 ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              state.phase === "completed"
                ? "bg-emerald-500"
                : "bg-violet-500",
            )}
            style={{ width: `${progressPercent}%` }}
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      ) : null}

      {/* Error message */}
      {state.phase === "failed" ? (
        <div className="rounded-lg border border-rose-500/35 bg-rose-950/30 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
          {state.error}
        </div>
      ) : null}

      {/* Completed summary */}
      {state.phase === "completed" ? (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 px-3 py-2 text-[12px] text-emerald-200">
          Workflow completed successfully.
          <span className="ml-2 font-mono text-[10px] text-emerald-400/70">
            {state.result.executionId}
          </span>
        </div>
      ) : null}

      {/* Live node steps */}
      {liveSteps.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            Node progress
          </p>
          <ul className="space-y-1">
            {liveSteps.map((step) => (
              <li
                key={step.nodeId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-[#16161f] px-3 py-2 text-[11px]"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-zinc-200">
                  {step.nodeId}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                  {step.nodeType}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  {step.status === "running" ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin text-violet-400"
                      aria-hidden
                    />
                  ) : null}
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                      step.status === "pending" && "bg-zinc-600/25 text-zinc-400",
                      step.status === "running" && "bg-violet-500/20 text-violet-200",
                      step.status === "ok" && "bg-emerald-500/20 text-emerald-300",
                      step.status === "failed" && "bg-rose-500/25 text-rose-200",
                    )}
                  >
                    {step.status}
                  </span>
                </span>
                {step.status === "failed" && step.error ? (
                  <pre className="mt-1 w-full max-h-[60px] overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 font-mono text-[10px] text-rose-100/90">
                    {step.error}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
