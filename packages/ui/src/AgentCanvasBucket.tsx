import { BookMarked, ChevronDown, ChevronRight, Plus, Trash2, Users } from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import { cn } from "./cn.js";

export interface AgentBucketRow {
  name: string;
  model: string;
  systemPrompt: string;
  source: "inline" | "library";
}

export interface AgentLibraryEntryLite {
  id: string;
  name: string;
  model?: string;
  systemPrompt?: string;
}

export function deriveAgentBucketRows(
  wfType: string,
  config: unknown,
  libraryEntries: readonly AgentLibraryEntryLite[],
): readonly AgentBucketRow[] {
  if (!config || typeof config !== "object") return [];
  const cfg = config as { agents?: unknown };
  if (!cfg.agents || typeof cfg.agents !== "object") return [];
  const agents = cfg.agents as unknown[];
  if (!Array.isArray(agents)) return [];
  return agents
    .filter((a): a is Record<string, unknown> =>
      a !== null &&
      typeof a === "object" &&
      "name" in a &&
      typeof (a as any).name === "string" &&
      "systemPrompt" in a &&
      typeof (a as any).systemPrompt === "string"
    )
    .map((a) => {
      const rec = a as Record<string, unknown>;
      const src = rec.source;
      const source: "inline" | "library" = (src === "inline" || src === "library") ? src : "inline";
      const mod = rec.model;
      const model = typeof mod === "string" ? mod : "";
      return {
        name: rec.name as string,
        model,
        systemPrompt: rec.systemPrompt as string,
        source,
      };
    });
}

export function isAgentBucketNodeType(type: string): boolean {
  return (
    type === "autogen.multi-agent" ||
    type === "autogen.single-agent" ||
    type === "llm.openai.chat"
  );
}

export function supportsCanvasAgentAdd(type: string): boolean {
  return type === "autogen.multi-agent";
}

const COLLAPSE_AFTER = 4;
const PREVIEW_COUNT = 3;

function stopNodeDrag(e: SyntheticEvent): void {
  e.stopPropagation();
}

type BucketRowProps = {
  row: AgentBucketRow;
  index: number;
  nodeId: string;
  bucketVariant: "single" | "team";
  onEditRow?: (nodeId: string, index: number) => void;
  onDeleteRow?: (nodeId: string, index: number) => void;
  showDelete: boolean;
};

function InteractiveBucketRow(props: BucketRowProps): ReactElement {
  const {
    row,
    index,
    nodeId,
    bucketVariant,
    onEditRow,
    onDeleteRow,
    showDelete,
  } = props;
  const isTeam = bucketVariant === "team";
  const fromLib = row.source === "library";
  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEditRow?.(nodeId, index);
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        onEditRow?.(nodeId, index);
      }}
      onPointerDown={stopNodeDrag}
      className={cn(
        "group/row flex cursor-pointer items-stretch gap-2 rounded-xl border bg-white/[0.02] px-2.5 transition",
        isTeam ? "min-h-[3.25rem] py-2.5" : "min-h-[2.75rem] py-2",
        fromLib && isTeam
          ? "border-emerald-500/35 bg-emerald-950/[0.12] ring-1 ring-emerald-500/15"
          : isTeam
            ? "border-white/[0.06] hover:border-violet-500/30 hover:bg-violet-500/[0.08] hover:shadow-[inset_0_0_0_1px_rgba(139,92,246,0.12)]"
            : "border-cyan-500/20 bg-cyan-950/[0.08] hover:border-cyan-400/35 hover:bg-cyan-950/15",
      )}
    >
      <div className="min-w-0 flex-1 text-left">
        <div className="flex min-w-0 items-center gap-1.5">
          {fromLib && isTeam ? (
            <BookMarked
              className="h-3.5 w-3.5 shrink-0 text-emerald-400/90"
              aria-hidden
            />
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-semibold leading-tight text-zinc-100",
              isTeam ? "text-[12px]" : "text-[11px]",
            )}
          >
            {row.name}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wider",
              fromLib
                ? "bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/35"
                : "bg-zinc-600/35 text-zinc-300 ring-1 ring-white/10",
            )}
          >
            {fromLib ? "LIBRARY" : "INLINE"}
          </span>
        </div>
        <p
          className={cn(
            "truncate font-mono leading-tight text-violet-300/90",
            isTeam ? "mt-1 text-[10px]" : "mt-0.5 text-[9px]",
          )}
        >
          {row.model}
        </p>
      </div>
      {showDelete && onDeleteRow ? (
        <button
          type="button"
          title="Remove agent"
          onPointerDown={stopNodeDrag}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteRow(nodeId, index);
          }}
          className={cn(
            "flex shrink-0 items-center justify-center self-center rounded-lg border text-zinc-400 transition hover:text-rose-300",
            isTeam
              ? "h-9 w-9 border-white/[0.08] hover:border-rose-500/40 hover:bg-rose-500/15"
              : "h-8 w-8 border-cyan-500/20 hover:border-rose-500/40 hover:bg-rose-500/15",
          )}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function AgentCanvasBucketInner(props: {
  nodeId: string;
  /** `single` = one LLM step; `team` = multi-agent with + Add. */
  variant: "single" | "team";
  rows: readonly AgentBucketRow[];
  onAddAgent?: (nodeId: string) => void;
  onEditRow?: (nodeId: string, index: number) => void;
  onDeleteRow?: (nodeId: string, index: number) => void;
}): ReactElement {
  const { nodeId, variant, rows, onAddAgent, onEditRow, onDeleteRow } = props;
  const isTeam = variant === "team";
  const [expanded, setExpanded] = useState(rows.length <= COLLAPSE_AFTER);

  useEffect(() => {
    if (rows.length > COLLAPSE_AFTER) setExpanded(false);
  }, [rows.length]);

  const needsCollapse = rows.length > COLLAPSE_AFTER;
  const visibleRows = useMemo(() => {
    if (!needsCollapse || expanded) return rows;
    return rows.slice(0, PREVIEW_COUNT);
  }, [rows, needsCollapse, expanded]);

  const hiddenCount = rows.length - visibleRows.length;
  const showDelete = Boolean(onDeleteRow);

  return (
    <div
      className={cn(
        "border-t bg-black/25",
        isTeam ? "px-2.5 pb-2.5 pt-2" : "px-2 pb-2 pt-1.5",
        isTeam
          ? "border-violet-500/15"
          : "border-cyan-500/25 ring-1 ring-inset ring-cyan-500/10",
      )}
      onPointerDown={stopNodeDrag}
    >
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span
          className={cn(
            "flex items-center gap-1 font-semibold uppercase tracking-wide",
            isTeam ? "text-[10px] text-violet-400/90" : "text-[9px] text-cyan-400/90",
          )}
        >
          {isTeam ? (
            <>
              <Users className="h-3 w-3 opacity-90" aria-hidden />
              Agents
            </>
          ) : (
            "Single Agent"
          )}
        </span>
        {needsCollapse ? (
          <button
            type="button"
            onPointerDown={stopNodeDrag}
            onClick={(e) => {
              stopNodeDrag(e);
              setExpanded((x) => !x);
            }}
            className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-violet-400/95 hover:bg-white/[0.06]"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )}
            {expanded ? "Hide" : `${rows.length} total`}
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div
          className={cn(
            "rounded-lg px-2 py-2 text-[10px] leading-relaxed",
            isTeam
              ? "border border-dashed border-violet-500/25 bg-violet-950/15 text-zinc-500"
              : "border border-dashed border-cyan-500/20 bg-cyan-950/10 text-zinc-500",
          )}
        >
          {isTeam ? (
            <>
              <span className="font-medium text-zinc-400">No agents yet.</span> Add
              teammates with <span className="text-violet-300/90">+ Add agent</span>{" "}
              below, pick from the Agent Library in the add dialog, or paste personas in
              Advanced JSON in the inspector.
            </>
          ) : (
            <>
              Set <span className="text-cyan-300/90">name</span>,{" "}
              <span className="text-cyan-300/90">model</span>, and{" "}
              <span className="text-cyan-300/90">prompt</span> in the inspector — or link a
              library entry there.
            </>
          )}
        </div>
      ) : (
        <ul className={cn("space-y-1.5", !isTeam && "space-y-1")}>
          {visibleRows.map((row, i) => (
            <li
              key={`${nodeId}-agent-${i}-${row.name}-${row.source}`}
              className="transition-opacity duration-200"
            >
              <InteractiveBucketRow
                row={row}
                index={i}
                nodeId={nodeId}
                bucketVariant={variant}
                onEditRow={onEditRow}
                onDeleteRow={onDeleteRow}
                showDelete={showDelete}
              />
            </li>
          ))}
        </ul>
      )}

      {!expanded && hiddenCount > 0 ? (
        <p className="mt-1.5 text-[10px] text-zinc-500">
          +{hiddenCount} more — expand to see all
        </p>
      ) : null}

      {onAddAgent ? (
        <button
          type="button"
          onPointerDown={stopNodeDrag}
          onClick={(e) => {
            stopNodeDrag(e);
            onAddAgent(nodeId);
          }}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-violet-500/40 bg-gradient-to-b from-violet-500/15 to-violet-950/20 py-2.5 text-[11px] font-semibold text-violet-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:border-violet-400/55 hover:from-violet-500/25 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add agent
        </button>
      ) : null}
    </div>
  );
}

export const AgentCanvasBucket = memo(AgentCanvasBucketInner);
