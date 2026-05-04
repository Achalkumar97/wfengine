import "reactflow/dist/style.css";
import "./reactFlowControlsFix.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "reactflow";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import type { WorkflowDefinition } from "@wfengine/shared";
import type { PaletteNodeMeta } from "./types.js";
import type { WfNodeData } from "./exportWorkflow.js";
import {
  exportWorkflowDefinition,
  workflowDefinitionToFlowState,
} from "./exportWorkflow.js";
import { GradientEdge } from "./GradientEdge.js";
import { WfNode } from "./WfNode.js";
import { layoutNodesDagre } from "./dagreLayout.js";
import { NodeActionsProvider } from "./NodeActionsContext.js";
import { cn } from "./cn.js";
import { RunFailureContext } from "./RunFailureContext.js";
import { studioNodeTitle } from "./nodeLabels.js";
import { CanvasAgentUiProvider } from "./CanvasAgentUiContext.js";

/** Deep-clone node data so Duplicate does not share `config` with the source node. */
function cloneWfNodeData(data: WfNodeData): WfNodeData {
  try {
    return structuredClone(data) as WfNodeData;
  } catch {
    return {
      ...data,
      config:
        typeof data.config === "object" &&
        data.config !== null &&
        !Array.isArray(data.config)
          ? { ...(data.config as Record<string, unknown>) }
          : {},
    };
  }
}

/** Right inspector primary tabs (Studio composes panel content). */
export type InspectorMainTab = "workflow" | "node" | "run";

export interface WorkflowCanvasHandle {
  exportWorkflowDefinition: () => WorkflowDefinition;
  importWorkflowDefinition: (def: WorkflowDefinition) => void;
  /** Replace canvas nodes/edges (e.g. restore layout from local snapshot). */
  replaceFlowState: (nodes: Node<WfNodeData>[], edges: Edge[]) => void;
  getNodes: () => Node<WfNodeData>[];
  getEdges: () => Edge[];
  undo: () => void;
  redo: () => void;
  fitView: () => void;
  autoLayout: () => void;
  /** Switch the right inspector tab (e.g. jump to Run after execution). */
  setInspectorTab: (tab: InspectorMainTab) => void;
  /** Merge full config for a node (power users + persona edit dialog). */
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
}

/** Minimal agent row for inspector tool/library pickers (Studio loads full library separately). */
export type InspectorAgentLibraryEntry = {
  id: string;
  name: string;
  /** Included so inspectors can insert/bind personas without a round-trip to stored JSON. */
  systemPrompt?: string | undefined;
  model?: string;
};

export interface InspectorRenderProps {
  selectedNode: Node<WfNodeData> | undefined;
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  /** All canvas nodes — used to wire AI tools to workflow node ids */
  workflowNodes: Node<WfNodeData>[];
  /** Reusable agents from Studio Agent Library (optional) */
  agentLibraryEntries?: readonly InspectorAgentLibraryEntry[] | undefined;
  /** Opens the Studio Agent Library dialog (manage / import personas). */
  onOpenAgentLibrary?: () => void;
}

export interface WorkflowCanvasProps {
  workflowId: string;
  version?: number | undefined;
  palette: PaletteNodeMeta[];
  initialNodes?: Node<WfNodeData>[];
  initialEdges?: Edge[];
  onExport?: (json: object) => void;
  renderInspector?: (props: InspectorRenderProps) => ReactNode;
  /** Right panel when the canvas has no node selected */
  renderWorkflowInspector?: () => ReactNode;
  /** Run tab body (e.g. last execution summary in Studio) */
  renderRunPanel?: () => ReactNode;
  className?: string;
  /** Fired when undo/redo stacks change (for toolbar) */
  onHistoryChange?: (state: {
    canUndo: boolean;
    canRedo: boolean;
  }) => void;
  /** Icon for each palette row (Lucide etc.) — runs in Studio only */
  renderPaletteIcon?: (meta: PaletteNodeMeta) => ReactNode;
  /** Node ids that failed in the last run — shown with error styling on canvas */
  runFailedNodeIds?: readonly string[];
  /** Studio: retry one node with cached upstream outputs (shows Re-run on node toolbar). */
  onReRunNodeWithCache?: (nodeId: string) => void;
  /** Studio: Agent Library entries for AI node tool pickers */
  agentLibraryEntries?: readonly InspectorAgentLibraryEntry[] | undefined;
  /** Studio: open the Agent Library management dialog from AI inspectors */
  onOpenAgentLibrary?: () => void;
  /**
   * Fired after the node is selected when the user clicks **Add agent** on the canvas
   * agent bucket (e.g. open Agent Library + focus Node inspector in Studio).
   */
  onAgentBucketAdd?: (nodeId: string) => void;
  /** After select — open persona editor (e.g. Studio dialog). */
  onAgentBucketEditRow?: (nodeId: string, index: number) => void;
  /** When delete would violate min agent count (toast in Studio). */
  onAgentBucketDeleteRejected?: (reason: "below_minimum") => void;
}

function miniMapColorForType(wfType: unknown): string {
  const t = typeof wfType === "string" ? wfType : "";
  if (t.startsWith("trigger.")) return "#22c55e"; // green
  if (t === "postgres.query" || t === "file.read" || t === "file.write") {
    return "#60a5fa"; // blue
  }
  return "#a78bfa"; // violet
}

const PALETTE_MIME = "application/wfengine-palette";

const defaultEdgeOptions = {
  type: "turboGradient" as const,
  animated: true,
};

function useGraphUndo(
  nodes: Node<WfNodeData>[],
  edges: Edge[],
  setNodes: (
    fn:
      | Node<WfNodeData>[]
      | ((n: Node<WfNodeData>[]) => Node<WfNodeData>[]),
  ) => void,
  setEdges: (fn: Edge[] | ((e: Edge[]) => Edge[])) => void,
) {
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const lastSerialized = useRef(JSON.stringify({ nodes, edges }));
  const restoring = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    const serialized = JSON.stringify({ nodes, edges });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (restoring.current) {
        restoring.current = false;
        lastSerialized.current = serialized;
        return;
      }
      if (lastSerialized.current !== serialized) {
        setUndoStack((u) => [...u.slice(-49), lastSerialized.current]);
        setRedoStack([]);
        lastSerialized.current = serialized;
      }
    }, 420);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nodes, edges]);

  const undo = useCallback(() => {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const prevSnap = u[u.length - 1]!;
      const parsed = JSON.parse(prevSnap) as {
        nodes: Node<WfNodeData>[];
        edges: Edge[];
      };
      setRedoStack((r) =>
        [...r, JSON.stringify({ nodes, edges })].slice(-50),
      );
      restoring.current = true;
      lastSerialized.current = prevSnap;
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
      return u.slice(0, -1);
    });
  }, [nodes, edges, setEdges, setNodes]);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const nextSnap = r[r.length - 1]!;
      const parsed = JSON.parse(nextSnap) as {
        nodes: Node<WfNodeData>[];
        edges: Edge[];
      };
      setUndoStack((u) =>
        [...u, JSON.stringify({ nodes, edges })].slice(-50),
      );
      restoring.current = true;
      lastSerialized.current = nextSnap;
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
      return r.slice(0, -1);
    });
  }, [nodes, edges, setEdges, setNodes]);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  return { undo, redo, canUndo, canRedo };
}

/** Must be rendered as a child of ReactFlow */
function FlowClipboardBridge(props: {
  palette: PaletteNodeMeta[];
}): ReactElement {
  const { getNodes, setNodes, getEdges, setEdges } = useReactFlow();

  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      // Don't hijack Ctrl+C when copying ordinary selected text (Run panel errors,
      // docs, etc.) — those targets aren't inputs but still need native copy.
      const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
      if (sel != null && sel.toString().length > 0) {
        return;
      }
      if (!e.clipboardData) return;
      const selected = getNodes().filter((n) => n.selected);
      if (selected.length === 0) return;
      const ids = new Set(selected.map((n) => n.id));
      const edges = getEdges().filter(
        (ed) => ids.has(ed.source) && ids.has(ed.target),
      );
      const payload = JSON.stringify({
        wfengineClipboard: true,
        nodes: selected,
        edges,
      });
      e.clipboardData.setData("application/json", payload);
      e.clipboardData.setData("text/plain", payload);
      e.preventDefault();
    };

    const onPaste = (e: ClipboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      let raw = e.clipboardData?.getData("application/json");
      if (!raw) {
        raw = e.clipboardData?.getData("text/plain") ?? "";
      }
      if (!raw.trim()) return;
      try {
        const data = JSON.parse(raw) as {
          wfengineClipboard?: boolean;
          nodes?: Node<WfNodeData>[];
          edges?: Edge[];
        };
        if (!data.wfengineClipboard || !data.nodes?.length) return;

        const idMap = new Map<string, string>();
        const t = Date.now();
        const newNodes: Node<WfNodeData>[] = data.nodes.map((n, i) => {
          const nid = `${n.data.wfType}-${t}-${i}`;
          idMap.set(n.id, nid);
          return {
            ...n,
            id: nid,
            selected: true,
            position: {
              x: n.position.x + 48,
              y: n.position.y + 48,
            },
          };
        });

        const newEdges: Edge[] = (data.edges ?? []).map((ed, i) => ({
          ...ed,
          id: `paste-${t}-${i}`,
          source: idMap.get(ed.source) ?? ed.source,
          target: idMap.get(ed.target) ?? ed.target,
        }));

        setNodes((nds) => [
          ...nds.map((n) => ({ ...n, selected: false })),
          ...newNodes,
        ]);
        setEdges((eds) => [...eds, ...newEdges]);
        e.preventDefault();
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  }, [getEdges, getNodes, setEdges, setNodes]);

  void props.palette;
  return <></>;
}

const WorkflowCanvasInner = forwardRef<
  WorkflowCanvasHandle,
  WorkflowCanvasProps
>(function WorkflowCanvasInner(props, ref): ReactElement {
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const nodeTypes = useMemo(() => ({ wfNode: WfNode }), []);
  const edgeTypes = useMemo(() => ({ turboGradient: GradientEdge }), []);

  const [nodes, setNodes, onNodesChange] = useNodesState<WfNodeData>(
    props.initialNodes ?? [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    props.initialEdges ?? [],
  );

  const labelResolver = useCallback(
    (type: string) =>
      props.palette.find((p) => p.type === type)?.label ?? type,
    [props.palette],
  );

  const { undo, redo, canUndo, canRedo } = useGraphUndo(
    nodes,
    edges,
    setNodes,
    setEdges,
  );

  const onHistoryChangeRef = useRef(props.onHistoryChange);
  onHistoryChangeRef.current = props.onHistoryChange;
  useEffect(() => {
    onHistoryChangeRef.current?.({ canUndo, canRedo });
  }, [canUndo, canRedo]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNode = nodes.find((n) => n.id === selectedId);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorMainTab>("workflow");

  const updateNodeConfig = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, config } } : n,
        ),
      );
    },
    [setNodes],
  );

  const updateSelectedConfigJson = useCallback(
    (raw: string) => {
      if (!selectedId) return;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        updateNodeConfig(selectedId, parsed);
      } catch {
        /* invalid */
      }
    },
    [selectedId, updateNodeConfig],
  );

  const addNodeAt = useCallback(
    (meta: PaletteNodeMeta, position: { x: number; y: number }) => {
      const id = `${meta.type}-${Math.random().toString(36).slice(2, 9)}`;
      const node: Node<WfNodeData> = {
        id,
        type: "wfNode",
        position,
        data: {
          wfType: meta.type,
          label: meta.label,
          config: meta.defaultConfig ? { ...meta.defaultConfig } : {},
        },
      };
      setNodes((nds) => [...nds, node]);
      setSelectedId(id);
    },
    [setNodes],
  );

  const addNode = useCallback(
    (meta: PaletteNodeMeta) => {
      addNodeAt(meta, {
        x: 80 + nodes.length * 28,
        y: 60 + nodes.length * 22,
      });
    },
    [addNodeAt, nodes.length],
  );

  const onDragOverPalette = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDropCanvas = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(PALETTE_MIME);
      if (!raw) return;
      const inst = rfRef.current;
      if (!inst) return;
      try {
        const meta = JSON.parse(raw) as PaletteNodeMeta;
        const position = inst.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        });
        addNodeAt(meta, position);
      } catch {
        /* ignore */
      }
    },
    [addNodeAt],
  );

  const onDragStartPalette = useCallback(
    (e: DragEvent, meta: PaletteNodeMeta) => {
      e.dataTransfer.setData(PALETTE_MIME, JSON.stringify(meta));
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const importWorkflowDefinition = useCallback(
    (def: WorkflowDefinition) => {
      const { nodes: nextNodes, edges: nextEdges } =
        workflowDefinitionToFlowState(def, labelResolver);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelectedId(null);
      queueMicrotask(() => rfRef.current?.fitView({ padding: 0.2 }));
    },
    [labelResolver, setEdges, setNodes],
  );

  const replaceFlowState = useCallback(
    (nextNodes: Node<WfNodeData>[], nextEdges: Edge[]) => {
      setNodes(nextNodes.map((n) => ({ ...n, selected: false })));
      setEdges(nextEdges);
      setSelectedId(null);
      queueMicrotask(() => rfRef.current?.fitView({ padding: 0.2 }));
    },
    [setEdges, setNodes],
  );

  const fitView = useCallback(() => {
    rfRef.current?.fitView({ padding: 0.15 });
  }, []);

  const autoLayout = useCallback(() => {
    setNodes((n) => layoutNodesDagre(n, edges));
    queueMicrotask(() => rfRef.current?.fitView({ padding: 0.2 }));
  }, [edges, setNodes]);

  useImperativeHandle(
    ref,
    () => ({
      exportWorkflowDefinition: () =>
        exportWorkflowDefinition(
          props.workflowId,
          props.version,
          nodes,
          edges,
        ),
      importWorkflowDefinition,
      replaceFlowState,
      getNodes: () => nodes,
      getEdges: () => edges,
      undo,
      redo,
      fitView,
      autoLayout,
      setInspectorTab,
      updateNodeConfig,
    }),
    [
      nodes,
      edges,
      props.workflowId,
      props.version,
      importWorkflowDefinition,
      replaceFlowState,
      undo,
      redo,
      fitView,
      autoLayout,
      updateNodeConfig,
    ],
  );

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const n = nodes.find((x) => x.id === nodeId);
      if (!n) return;
      const newId = `${n.data.wfType}-${Math.random().toString(36).slice(2, 9)}`;
      const dup: Node<WfNodeData> = {
        ...n,
        id: newId,
        position: { x: n.position.x + 48, y: n.position.y + 48 },
        selected: true,
        data: cloneWfNodeData(n.data),
      };
      setNodes((nds) => [...nds.map((nn) => ({ ...nn, selected: false })), dup]);
      setSelectedId(newId);
    },
    [nodes, setNodes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
      setSelectedId((sid) => (sid === nodeId ? null : sid));
    },
    [setEdges, setNodes],
  );

  const selectAndFocus = useCallback((nodeId: string) => {
    setSelectedId(nodeId);
    setNodes((nds) =>
      nds.map((n) => ({ ...n, selected: n.id === nodeId })),
    );
  }, [setNodes]);

  const onAgentBucketAddInternal = useCallback(
    (nodeId: string) => {
      selectAndFocus(nodeId);
      props.onAgentBucketAdd?.(nodeId);
    },
    [selectAndFocus, props.onAgentBucketAdd],
  );

  const deleteAgentRow = useCallback(
    (nodeId: string, index: number) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const wfType = n.data.wfType;
          if (wfType === "autogen.agent") {
            if (index !== 0) return n;
            const cfg = { ...(n.data.config ?? {}) } as Record<string, unknown>;
            const nextCfg = { ...cfg };
            delete nextCfg.libraryAgentId;
            nextCfg.agentName = "agent";
            nextCfg.systemPrompt =
              "Describe this agent's role and behavior in one or two sentences.";
            return {
              ...n,
              data: { ...n.data, config: nextCfg },
            };
          }
          if (wfType !== "mfa.agent-group" && wfType !== "autogen.multi-agent") {
            return n;
          }
          const cfg = { ...(n.data.config ?? {}) } as Record<string, unknown>;
          const agents = cfg.agents;
          if (!Array.isArray(agents)) return n;
          if (index < 0 || index >= agents.length) return n;
          const next = agents.filter((_, i) => i !== index);
          const min = wfType === "autogen.multi-agent" ? 2 : 1;
          if (next.length < min) {
            props.onAgentBucketDeleteRejected?.("below_minimum");
            return n;
          }
          return {
            ...n,
            data: { ...n.data, config: { ...cfg, agents: next } },
          };
        }),
      );
    },
    [setNodes, props.onAgentBucketDeleteRejected],
  );

  const onEditAgentFromBucket = useCallback(
    (nodeId: string, index: number) => {
      selectAndFocus(nodeId);
      props.onAgentBucketEditRow?.(nodeId, index);
    },
    [selectAndFocus, props.onAgentBucketEditRow],
  );

  const canvasAgentUiValue = useMemo(
    () => ({
      libraryEntries: props.agentLibraryEntries ?? [],
      onAddAgentFromBucket: onAgentBucketAddInternal,
      onEditAgentRow: onEditAgentFromBucket,
      onDeleteAgentRow: deleteAgentRow,
    }),
    [
      props.agentLibraryEntries,
      onAgentBucketAddInternal,
      onEditAgentFromBucket,
      deleteAgentRow,
    ],
  );

  const nodeActions = useMemo(
    () => ({
      selectAndFocus,
      duplicateNode,
      deleteNode,
      ...(props.onReRunNodeWithCache
        ? { reRunWithCachedInputs: props.onReRunNodeWithCache }
        : {}),
    }),
    [
      selectAndFocus,
      duplicateNode,
      deleteNode,
      props.onReRunNodeWithCache,
    ],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (mod && e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const [paletteQuery, setPaletteQuery] = useState("");

  const groupedPalette = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    const filtered = props.palette.filter((p) => {
      if (!q) return true;
      return (
        p.label.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false)
      );
    });
    const map = new Map<string, PaletteNodeMeta[]>();
    for (const p of filtered) {
      const cat = p.category ?? "Actions";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    const order = ["Triggers", "Actions", "Data"];
    const rest = [...map.keys()].filter((k) => !order.includes(k)).sort();
    const keys = [...order.filter((k) => map.has(k)), ...rest];
    return keys.map((k) => ({ key: k, items: map.get(k)! }));
  }, [paletteQuery, props.palette]);

  const configJson = selectedNode
    ? JSON.stringify(selectedNode.data.config ?? {}, null, 2)
    : "{}";

  const runFailureSet = useMemo(() => {
    const ids = props.runFailedNodeIds;
    if (!ids?.length) return null;
    return new Set(ids);
  }, [props.runFailedNodeIds]);

  const defaultInspector = (
    <textarea
      aria-label="Node configuration JSON"
      className="mt-2 min-h-[140px] w-full resize-y rounded-lg border border-white/[0.08] bg-[#1a1a22] px-3 py-2 font-mono text-xs leading-relaxed text-zinc-300 outline-none ring-violet-400/15 focus:border-violet-400/45 focus:ring-2"
      defaultValue={configJson}
      key={selectedId ?? "none"}
      onBlur={(e) => updateSelectedConfigJson(e.target.value)}
    />
  );

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            type: "turboGradient",
          },
          eds,
        ),
      ),
    [setEdges],
  );

  const onNodesDelete = useCallback(() => {
    setSelectedId(null);
  }, []);

  return (
    <NodeActionsProvider value={nodeActions}>
      <div
        className={cn(
          "flex h-full min-h-0 w-full min-w-0 flex-row overflow-hidden",
          props.className,
        )}
      >
        {/* Fixed-width library: avoids react-resizable-panels % / min-width fighting and collapsed sidebars */}
        <aside className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-[#13131a] sm:w-[300px]">
          <div className="shrink-0 border-b border-white/[0.06] px-3 py-3">
            <p className="font-[system-ui,-apple-system,sans-serif] text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Node Library
            </p>
            <input
              type="search"
              placeholder="Search nodes…"
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              className="mt-2 w-full min-w-0 rounded-lg border border-white/[0.08] bg-[#1a1a22] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 outline-none ring-violet-400/15 focus:border-violet-400/45 focus:ring-2"
            />
          </div>
          <div className="wf-panel-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3">
            {groupedPalette.map(({ key, items }) => (
              <details
                key={key}
                open
                className="group mb-2.5 rounded-xl border border-white/[0.06] bg-[#16161f]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
              >
                <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold tracking-wide text-zinc-400 hover:text-zinc-200">
                  {key}
                </summary>
                <div className="space-y-1.5 px-2 pb-3 pt-1">
                  {items.map((p) => (
                    <button
                      key={p.type}
                      type="button"
                      draggable
                      title={p.description}
                      onDragStart={(e) => onDragStartPalette(e, p)}
                      onClick={() => addNode(p)}
                      className="flex w-full flex-col rounded-lg border border-white/[0.06] bg-[#1a1a22]/90 px-2.5 py-2.5 text-left transition hover:border-violet-400/35 hover:bg-[#222231]/95"
                    >
                      <span className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-violet-400 opacity-90">
                          {props.renderPaletteIcon?.(p) ?? (
                            <span className="inline-block h-4 w-4 rounded bg-zinc-800" />
                          )}
                        </span>
                        <span className="text-[13px] font-medium leading-snug text-zinc-200">
                          {p.label}
                        </span>
                      </span>
                      {p.description ? (
                        <span className="mt-0.5 line-clamp-2 break-words text-[11px] leading-snug text-zinc-400">
                          {p.description}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </aside>

        <div className="relative min-h-0 min-w-0 flex-1 bg-[#09090e]">
          <RunFailureContext.Provider value={runFailureSet}>
          <CanvasAgentUiProvider value={canvasAgentUiValue}>
          <ReactFlow
            onInit={(instance) => {
              rfRef.current = instance;
            }}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            minZoom={0.2}
            maxZoom={1.8}
            deleteKeyCode={["Backspace", "Delete"]}
            multiSelectionKeyCode={["Meta", "Control"]}
            selectionOnDrag
            panOnDrag={[1, 2]}
            onDragOver={onDragOverPalette}
            onDrop={onDropCanvas}
            onNodesDelete={onNodesDelete}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            proOptions={{ hideAttribution: true }}
            className="wf-turbo-canvas h-full w-full bg-[#09090e]"
          >
            <FlowClipboardBridge palette={props.palette} />
            <div className="pointer-events-none absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
              <div
                className={cn(
                  "pointer-events-auto overflow-hidden rounded-2xl border border-white/[0.12] bg-black/30 shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur",
                  "transition-opacity",
                  overviewOpen ? "opacity-100" : "opacity-70 hover:opacity-100",
                )}
              >
                <button
                  type="button"
                  onClick={() => setOverviewOpen((v) => !v)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border-b border-white/[0.08] px-3 py-2 text-left",
                    "text-[11px] font-semibold tracking-wide text-zinc-200",
                    "bg-[#15151d]/70 hover:bg-[#1b1b26]/80",
                  )}
                  aria-expanded={overviewOpen}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-zinc-200">Overview</span>
                    <span className="hidden items-center gap-2 text-[10px] font-medium text-zinc-400 sm:flex">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: miniMapColorForType("trigger.") }}
                        />
                        Trigger
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: miniMapColorForType("postgres.query") }}
                        />
                        Data
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: miniMapColorForType("http.request") }}
                        />
                        Action
                      </span>
                    </span>
                  </span>
                  <span className="text-zinc-400">{overviewOpen ? "▾" : "▸"}</span>
                </button>

                {overviewOpen ? (
                  <div className="h-[120px] w-[190px]">
                    <MiniMap
                      zoomable
                      pannable
                      className={cn(
                        "!m-0 !h-full !w-full !rounded-none !border-0",
                        "!bg-[#0e0e14]/70",
                      )}
                      maskColor="rgba(9,9,14,0.82)"
                      nodeStrokeColor="rgba(255,255,255,0.10)"
                      nodeBorderRadius={8}
                      nodeColor={(n) =>
                        miniMapColorForType(
                          (n as { data?: { wfType?: unknown } }).data?.wfType,
                        )
                      }
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <Controls
              className={cn(
                "!rounded-xl !border !border-white/[0.1] !bg-[#1a1a22] !shadow-md",
                "[&_button]:!rounded-none [&_button]:!border-0 [&_button]:!border-b [&_button]:!border-white/[0.06] [&_button]:!bg-[#252530]",
                "[&_button:first-child]:!rounded-t-lg [&_button:last-child]:!rounded-b-lg [&_button:last-child]:!border-b-0",
                "[&_button:hover]:!bg-[#2e2e3a]",
              )}
            />
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1.15}
              color="#3f3f52"
              className="opacity-[0.28]"
            />
          </ReactFlow>
          </CanvasAgentUiProvider>
          </RunFailureContext.Provider>
        </div>

        <aside className="flex h-full w-[300px] shrink-0 flex-col overflow-hidden border-l border-white/[0.06] bg-[#13131a] lg:w-[340px]">
          <div className="shrink-0 border-b border-white/[0.06] px-4 py-3">
            <p className="font-[system-ui,-apple-system,sans-serif] text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Inspector
            </p>
            <div
              className="mt-3 flex rounded-lg border border-white/[0.08] bg-[#16161f] p-0.5"
              role="tablist"
              aria-label="Inspector sections"
            >
              {(
                [
                  ["workflow", "Workflow"],
                  ["node", "Node"],
                  ["run", "Run"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === id}
                  id={`inspector-tab-${id}`}
                  onClick={() => setInspectorTab(id)}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition",
                    inspectorTab === id
                      ? "bg-[#252530] text-zinc-100 shadow-sm ring-1 ring-white/[0.06]"
                      : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="wf-panel-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-3">
            {inspectorTab === "workflow" ? (
              props.renderWorkflowInspector ? (
                props.renderWorkflowInspector()
              ) : (
                <p className="text-sm leading-relaxed text-zinc-400">
                  Workflow-level settings are not configured for this canvas.
                </p>
              )
            ) : inspectorTab === "node" ? (
              selectedNode ? (
                <>
                  <div className="mb-3 rounded-xl border border-white/[0.06] bg-[#1a1a22] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      Selected
                    </p>
                    <p className="mt-1 truncate text-[15px] font-semibold tracking-tight text-zinc-100">
                      {studioNodeTitle(
                        selectedNode.data.wfType,
                        selectedNode.data.label,
                      )}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">
                      {selectedNode.data.wfType}
                    </p>
                  </div>
                  {props.renderInspector ? (
                    props.renderInspector({
                      selectedNode,
                      updateNodeConfig,
                      workflowNodes: nodes,
                      agentLibraryEntries: props.agentLibraryEntries,
                      onOpenAgentLibrary: props.onOpenAgentLibrary,
                    })
                  ) : (
                    defaultInspector
                  )}
                </>
              ) : (
                <p className="text-sm leading-relaxed text-zinc-400">
                  Select a node on the canvas to edit its configuration.
                </p>
              )
            ) : props.renderRunPanel ? (
              props.renderRunPanel()
            ) : (
              <p className="text-sm leading-relaxed text-zinc-400">
                Run output panel is not connected for this canvas.
              </p>
            )}
          </div>
        </aside>
      </div>
    </NodeActionsProvider>
  );
});

export const WorkflowCanvas = forwardRef<
  WorkflowCanvasHandle,
  WorkflowCanvasProps
>(function WorkflowCanvas(props, ref): ReactElement {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} ref={ref} />
    </ReactFlowProvider>
  );
});
