import {
  AgentToolRefSchema,
  type AgentToolRef,
} from "@wfengine/nodes-agents/schemas";
import type { WfNodeData } from "@wfengine/ui";
import { studioNodeTitle } from "@wfengine/ui";
import { Trash2 } from "lucide-react";
import { type ReactElement, useMemo } from "react";
import type { Node } from "reactflow";

const miniLabel = (c?: string) =>
  "mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500 " +
  (c ?? "");
const miniInput =
  "w-full rounded-xl border border-white/[0.08] bg-[#1a1a22] px-2.5 py-1.5 text-sm text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none ring-violet-400/15 focus:border-violet-400/45 focus:ring-2";

export interface AgentToolsPickerProps {
  tools: AgentToolRef[] | undefined;
  onChange: (next: AgentToolRef[]) => void;
  workflowNodes: Node<WfNodeData>[];
  /** Hide these ids (e.g. the agent node itself) */
  excludeNodeIds?: readonly string[];
  agentLibraryEntries?: readonly { id: string; name: string; model?: string }[];
}

function shortId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function primaryTitle(
  t: AgentToolRef,
  workflowNodes: Node<WfNodeData>[],
  agentLibraryEntries: readonly { id: string; name: string }[],
): string {
  if (t.kind === "workflow_node") {
    const n = workflowNodes.find((x) => x.id === t.nodeId);
    if (n) {
      return studioNodeTitle(n.data.wfType, n.data.label ?? "");
    }
    return t.displayName?.trim() || t.nodeId;
  }
  const named =
    t.displayName?.trim() ||
    agentLibraryEntries.find((a) => a.id === t.agentId)?.name;
  return named?.length ? named : "Library agent";
}

function secondaryLine(
  t: AgentToolRef,
  workflowNodes: Node<WfNodeData>[],
): string {
  if (t.kind === "workflow_node") {
    const n = workflowNodes.find((x) => x.id === t.nodeId);
    const idPart = `node id · ${shortId(t.nodeId)}`;
    return n
      ? `${n.data.wfType} · ${idPart}`
      : `workflow_node · ${idPart}`;
  }
  return `library_agent · ${shortId(t.agentId)}`;
}

export function AgentToolsPicker(props: AgentToolsPickerProps): ReactElement {
  const {
    tools,
    onChange,
    workflowNodes,
    excludeNodeIds = [],
    agentLibraryEntries = [],
  } = props;

  const exclude = useMemo(() => new Set(excludeNodeIds), [excludeNodeIds]);

  const nodeOptions = useMemo(
    () => workflowNodes.filter((n) => n.id && !exclude.has(n.id)),
    [workflowNodes, exclude],
  );

  const list = tools ?? [];

  function removeAt(i: number): void {
    const next = list.filter((_, j) => j !== i);
    onChange(next);
  }

  function addWorkflowNode(nodeId: string): void {
    if (!nodeId) return;
    const n = workflowNodes.find((x) => x.id === nodeId);
    const ref: AgentToolRef = {
      kind: "workflow_node",
      nodeId,
      displayName: n
        ? studioNodeTitle(n.data.wfType, n.data.label ?? "")
        : nodeId,
    };
    const parsed = AgentToolRefSchema.safeParse(ref);
    if (!parsed.success) return;
    onChange([...list, parsed.data]);
  }

  function addLibraryAgent(agentId: string): void {
    if (!agentId) return;
    const entry = agentLibraryEntries.find((a) => a.id === agentId);
    const ref: AgentToolRef = {
      kind: "library_agent",
      agentId,
      displayName: entry?.name,
    };
    const parsed = AgentToolRefSchema.safeParse(ref);
    if (!parsed.success) return;
    onChange([...list, parsed.data]);
  }

  return (
    <div className="space-y-3 rounded-lg border border-white/[0.06] bg-[#14141c]/80 p-3">
      <p className="text-[11px] leading-snug text-zinc-500">
        The model can call these during the run. Add canvas nodes or library agents below, then see the
        list with friendly names.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className={miniLabel()}>Add canvas node</label>
          <select
            className={miniInput}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              if (v) addWorkflowNode(v);
            }}
          >
            <option value="">Choose node…</option>
            {nodeOptions.map((n) => (
              <option key={n.id} value={n.id}>
                {`${studioNodeTitle(n.data.wfType, n.data.label ?? "")} · ${n.id}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={miniLabel()}>Add library agent</label>
          <select
            className={miniInput}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              if (v) addLibraryAgent(v);
            }}
          >
            <option value="">
              {agentLibraryEntries.length ? "Choose agent…" : "No agents in library"}
            </option>
            {agentLibraryEntries.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list.length ? (
        <ul className="space-y-2 border-t border-white/[0.06] pt-3">
          {list.map((t, i) => (
            <li
              key={`${t.kind}-${i}-${t.kind === "workflow_node" ? t.nodeId : t.agentId}`}
              className="flex items-start justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#0f0f15] px-2 py-1.5 text-xs text-zinc-300"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-100">
                  {primaryTitle(t, workflowNodes, agentLibraryEntries)}
                </p>
                <p className="truncate font-mono text-[10px] text-zinc-500">
                  {secondaryLine(t, workflowNodes)}
                </p>
              </div>
              <button
                type="button"
                title="Remove"
                className="shrink-0 rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-rose-400"
                onClick={() => removeAt(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-white/[0.06] pt-3 text-[11px] text-zinc-600">
          No tools yet — use the dropdowns above.
        </p>
      )}
    </div>
  );
}
