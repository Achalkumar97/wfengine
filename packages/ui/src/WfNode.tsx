import { memo, type ReactElement } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "reactflow";
import type { WfNodeData } from "./exportWorkflow.js";
import { cn } from "./cn.js";
import { isTriggerType } from "./configPreview.js";
import { useNodeActions } from "./NodeActionsContext.js";
import { useRunFailureHighlight } from "./RunFailureContext.js";
import { studioNodeTitle, turboNodeSubtitle } from "./nodeLabels.js";
import { NodeGlyph } from "./NodeGlyph.js";

function WfNodeInner(props: NodeProps<WfNodeData>): ReactElement {
  const { id, data, selected } = props;
  const trigger = isTriggerType(data.wfType);
  const actions = useNodeActions();
  const runFailed = useRunFailureHighlight(id);
  const title = studioNodeTitle(data.wfType, data.label);
  const subtitle = turboNodeSubtitle(data);

  return (
    <>
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex gap-1 rounded-lg border border-white/[0.12] bg-[#1a1a22]/98 p-1 shadow-lg backdrop-blur-md"
      >
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-zinc-300 hover:bg-[#2e2e3a] hover:text-zinc-100"
          onClick={() => actions?.selectAndFocus(id)}
        >
          Edit
        </button>
        {actions?.reRunWithCachedInputs ? (
          <button
            type="button"
            title="Run only this step using outputs from the last full run"
            className="rounded-md px-2 py-1 text-xs font-medium text-emerald-300/95 hover:bg-emerald-950/40 hover:text-emerald-100"
            onClick={() => actions.reRunWithCachedInputs!(id)}
          >
            Re-run
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-zinc-300 hover:bg-[#2e2e3a] hover:text-zinc-100"
          onClick={() => actions?.duplicateNode(id)}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-rose-400 hover:bg-rose-950/50"
          onClick={() => actions?.deleteNode(id)}
        >
          Delete
        </button>
      </NodeToolbar>

      <div
        className={cn(
          "relative min-w-[220px] max-w-[280px] rounded-2xl p-[1px] transition-all duration-200",
          runFailed
            ? "bg-gradient-to-br from-rose-500/55 via-red-500/35 to-orange-500/35 shadow-[0_0_22px_rgba(244,63,94,0.38)]"
            : "bg-gradient-to-br from-fuchsia-500/35 via-violet-500/22 to-cyan-400/30",
          selected
            ? runFailed
              ? "shadow-[0_0_22px_rgba(244,63,94,0.42)]"
              : "shadow-[0_0_20px_rgba(174,83,186,0.22),0_0_14px_rgba(42,138,246,0.15)]"
            : runFailed
              ? "shadow-[0_0_18px_rgba(244,63,94,0.28)]"
              : "shadow-[0_0_14px_rgba(174,83,186,0.08),0_0_10px_rgba(42,138,246,0.06)] hover:shadow-[0_0_16px_rgba(174,83,186,0.14)]",
        )}
      >
        <div
          className="relative overflow-hidden rounded-2xl"
          style={{
            background:
              "linear-gradient(165deg, rgba(14,14,18,0.98) 0%, rgba(4,4,8,0.99) 55%, rgba(8,8,14,0.99) 100%)",
            boxShadow:
              "inset 0 2px 20px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(255,255,255,0.025), inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
        >
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.05] to-transparent"
            aria-hidden
          />

        <Handle
          type="target"
          position={Position.Top}
          className="!h-2.5 !w-2.5 !border !border-fuchsia-400/90 !bg-zinc-950 !shadow-[0_0_10px_rgba(236,72,153,0.65)]"
        />

        <div className="relative px-3 pb-3 pt-2.5">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 rounded-lg bg-black/35 p-1 ring-1 ring-white/10">
              <NodeGlyph wfType={data.wfType} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[15px] font-semibold tracking-tight text-zinc-100">
                  {title}
                </span>
                {trigger ? (
                  <span className="shrink-0 rounded-full bg-gradient-to-r from-amber-500/25 to-fuchsia-600/25 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200/95 ring-1 ring-amber-400/35">
                    Trigger
                  </span>
                ) : runFailed ? (
                  <span className="shrink-0 rounded-full bg-rose-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-200 ring-1 ring-rose-400/45">
                    Failed
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400 ring-1 ring-white/[0.08]">
                    Step
                  </span>
                )}
              </div>
              <p className="mt-1 truncate font-mono text-[11px] leading-snug text-zinc-400">
                {subtitle}
              </p>
            </div>
          </div>
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-2.5 !w-2.5 !border !border-cyan-400/90 !bg-zinc-950 !shadow-[0_0_10px_rgba(34,211,238,0.65)]"
        />
        </div>
      </div>
    </>
  );
}

export const WfNode = memo(WfNodeInner);
