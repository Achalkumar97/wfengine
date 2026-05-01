import { cn, type WfNodeData, type WorkflowCanvasHandle } from "@wfengine/ui";
import type { WorkflowExecuteResult } from "@wfengine/core";
import { WorkflowCanvas } from "@wfengine/ui";
import {
  collectAncestorIds,
  parseWorkflow,
  topologicalSort,
  type WorkflowDefinition,
} from "@wfengine/shared";
import {
  ClipboardPaste,
  CloudUpload,
  FolderOpen,
  FileUp,
  HardDrive,
  Plus,
  Play,
  Redo2,
  Save,
  X,
  Undo2,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { toast, Toaster } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { NodeConfigPanel } from "./NodeConfigPanel.js";
import { STUDIO_DEMO_EDGES, STUDIO_DEMO_NODES } from "./demo-flow.js";
import { STUDIO_PALETTE } from "./palette-data.js";
import { PaletteGlyph } from "./palette-icons.js";
import { RunInspectorPanel, type LiveRunStep } from "./RunInspectorPanel.js";
import { WorkflowInspectorPanel } from "./WorkflowInspectorPanel.js";
import {
  createServerWorkflow,
  createServerWorkflowVersion,
  getServerWorkflowVersion,
  listServerWorkflows,
  type WorkflowRow,
} from "./server-api.js";
import {
  listWorkspaces,
  loadWorkspace,
  saveWorkspace,
  deleteWorkspace,
  loadStudioSnapshot,
  saveStudioSnapshot,
} from "./studio-persistence.js";
import type { Edge, Node } from "reactflow";

function apiBase(): string {
  const raw = import.meta.env.VITE_WFENGINE_API ?? "";
  return raw.replace(/\/$/, "");
}

type StudioTab = {
  tabId: string;
  localWorkspaceId?: string | undefined;
  remoteWorkflowId?: string | undefined;
  remoteVersionId?: string | undefined;
  workflowId: string;
  workflowDescription: string;
  initialDataRaw: string;
  nodes: Node<WfNodeData>[];
  edges: Edge[];
  dirty: boolean;
  savedAt?: string | undefined;
  runFailedNodeIds: string[];
  /** Per-node outputs from the last execution — used for Re-run on a single step */
  lastRunOutputs?: Record<string, unknown>;
};

function newTabId(): string {
  return `tab-${Math.random().toString(36).slice(2, 10)}`;
}

async function readNdjsonLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onObject: (v: unknown) => void,
): Promise<void> {
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      const t = line.trim();
      if (!t) continue;
      try {
        onObject(JSON.parse(t) as unknown);
      } catch {
        /* ignore malformed chunk */
      }
    }
    if (done) break;
  }
  const tail = buf.trim();
  if (tail) {
    try {
      onObject(JSON.parse(tail) as unknown);
    } catch {
      /* ignore trailing garbage */
    }
  }
}

export default function App(): ReactElement {
  const canvasRef = useRef<WorkflowCanvasHandle>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const [tabs, setTabs] = useState<StudioTab[] | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<WorkflowExecuteResult | null>(
    null,
  );
  const [lastRunDefinition, setLastRunDefinition] =
    useState<WorkflowDefinition | null>(null);
  const [runLiveSteps, setRunLiveSteps] = useState<LiveRunStep[] | null>(null);
  const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPasteRaw, setImportPasteRaw] = useState("");
  const [importPasteError, setImportPasteError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [serverWorkflows, setServerWorkflows] = useState<WorkflowRow[]>([]);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const activeTab = tabs?.find((t) => t.tabId === activeTabId);
  const localWorkspaces = useMemo(
    () => (libraryOpen ? listWorkspaces() : []),
    [libraryOpen, libraryRefresh],
  );

  useEffect(() => {
    if (!libraryOpen) return;
    let cancelled = false;
    setServerBusy(true);
    setServerError(null);
    void (async () => {
      try {
        const wfs = await listServerWorkflows();
        if (cancelled) return;
        setServerWorkflows(wfs);
      } catch (e) {
        if (cancelled) return;
        setServerError(e instanceof Error ? e.message : String(e));
        setServerWorkflows([]);
      } finally {
        if (!cancelled) setServerBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryOpen, libraryRefresh]);

  const flushCanvasIntoActiveTab = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    setTabs((prev) => {
      if (!prev || !activeTabId) return prev;
      const nodes = el.getNodes();
      const edges = el.getEdges();
      return prev.map((t) =>
        t.tabId === activeTabId ? { ...t, nodes, edges, dirty: true } : t,
      );
    });
  }, [activeTabId]);

  useEffect(() => {
    const metas = listWorkspaces();
    const latest = metas[0];
    if (latest) {
      const ws = loadWorkspace(latest.id);
      if (ws) {
        const tid = newTabId();
        setTabs([
          {
            tabId: tid,
            localWorkspaceId: ws.id,
            workflowId: ws.workflowId,
            workflowDescription: ws.workflowDescription,
            initialDataRaw: ws.initialDataRaw,
            nodes: ws.nodes,
            edges: ws.edges,
            dirty: false,
            savedAt: ws.savedAt,
            runFailedNodeIds: [],
            lastRunOutputs: undefined,
          },
        ]);
        setActiveTabId(tid);
        return;
      }
    }

    // Back-compat fallback if listWorkspaces couldn't load for some reason.
    const snap = loadStudioSnapshot();
    if (snap) {
      const tid = newTabId();
      setTabs([
        {
          tabId: tid,
          workflowId: snap.workflowId,
          workflowDescription: snap.workflowDescription,
          initialDataRaw: snap.initialDataRaw,
          nodes: snap.nodes,
          edges: snap.edges,
          dirty: false,
          savedAt: snap.savedAt,
          runFailedNodeIds: [],
          lastRunOutputs: undefined,
        },
      ]);
      setActiveTabId(tid);
      return;
    }

    const tid = newTabId();
    setTabs([
      {
        tabId: tid,
        workflowId: "studio-draft",
        workflowDescription: "",
        initialDataRaw: "{}",
        nodes: STUDIO_DEMO_NODES,
        edges: STUDIO_DEMO_EDGES,
        dirty: false,
        runFailedNodeIds: [],
        lastRunOutputs: undefined,
      },
    ]);
    setActiveTabId(tid);
  }, []);

  const applyImportedWorkflow = useCallback((def: ReturnType<typeof parseWorkflow>) => {
    // Import opens in a new tab.
    flushCanvasIntoActiveTab();
    const tid = newTabId();
    setTabs((prev) => [
      ...(prev ?? []),
      {
        tabId: tid,
        workflowId: def.id,
        workflowDescription: "",
        initialDataRaw: "{}",
        nodes: [],
        edges: [],
        dirty: true,
        runFailedNodeIds: [],
        lastRunOutputs: undefined,
      },
    ]);
    setActiveTabId(tid);
    setImportDialogOpen(false);
    setImportPasteError(null);
    setImportPasteRaw("");

    queueMicrotask(() => {
      const el = canvasRef.current;
      if (!el) return;
      el.importWorkflowDefinition(def);
      const nodes = el.getNodes();
      const edges = el.getEdges();
      setTabs((prev) =>
        (prev ?? []).map((t) =>
          t.tabId === tid
            ? {
                ...t,
                nodes,
                edges,
                dirty: true,
              }
            : t,
        ),
      );
      saveStudioSnapshot({
        workflowId: def.id,
        workflowDescription: "",
        initialDataRaw: "{}",
        nodes,
        edges,
      });
    });

    toast.success("Imported into a new tab — saved to this browser");
  }, [flushCanvasIntoActiveTab]);

  const openLocalWorkspaceInNewTab = useCallback(
    (workspaceId: string) => {
      const ws = loadWorkspace(workspaceId);
      if (!ws) {
        toast.error("Could not load that saved workflow");
        return;
      }
      flushCanvasIntoActiveTab();
      const tid = newTabId();
      setTabs((prev) => [
        ...(prev ?? []),
        {
          tabId: tid,
          localWorkspaceId: ws.id,
          workflowId: ws.workflowId,
          workflowDescription: ws.workflowDescription,
          initialDataRaw: ws.initialDataRaw,
          nodes: ws.nodes,
          edges: ws.edges,
          dirty: false,
          savedAt: ws.savedAt,
          runFailedNodeIds: [],
          lastRunOutputs: undefined,
        },
      ]);
      setActiveTabId(tid);
      setLibraryOpen(false);
      queueMicrotask(() => {
        canvasRef.current?.replaceFlowState(ws.nodes, ws.edges);
      });
      toast.success("Opened saved workflow in a new tab");
    },
    [flushCanvasIntoActiveTab],
  );

  const onExport = useCallback(() => {
    const def = canvasRef.current?.exportWorkflowDefinition();
    if (!def) return;
    const blob = new Blob([JSON.stringify(def, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${activeTab?.workflowId || "workflow"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Workflow exported");
  }, [activeTab?.workflowId]);

  const onSaveToBrowser = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    if (!activeTabId) return;
    const wf = tabs?.find((t) => t.tabId === activeTabId);
    if (!wf) return;
    const nodes = el.getNodes();
    const edges = el.getEdges();

    // New multi-workflow persistence (workspaces)
    const wid = wf.localWorkspaceId ?? `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    saveWorkspace(wid, {
      title: wf.workflowId || "untitled",
      workflowId: wf.workflowId,
      workflowDescription: wf.workflowDescription,
      initialDataRaw: wf.initialDataRaw,
      nodes,
      edges,
    });

    // Back-compat single snapshot (kept for now)
    saveStudioSnapshot({
      workflowId: wf.workflowId,
      workflowDescription: wf.workflowDescription,
      initialDataRaw: wf.initialDataRaw,
      nodes,
      edges,
    });
    setTabs((prev) =>
      (prev ?? []).map((t) =>
        t.tabId === activeTabId
          ? { ...t, dirty: false, savedAt: new Date().toISOString() }
          : t,
      ),
    );
    toast.success("Saved to this browser — survives refresh");
  }, [activeTabId, tabs]);

  const runWorkflow = useCallback(async () => {
    const el = canvasRef.current;
    if (!el) return;
    if (!activeTab) return;
    const definition = el.exportWorkflowDefinition();
    if (!definition.nodes.length) {
      toast.error("Add at least one node before running.");
      return;
    }
    let initialData: unknown = undefined;
    try {
      const trimmed = activeTab.initialDataRaw.trim();
      if (trimmed.length > 0) {
        initialData = JSON.parse(trimmed) as unknown;
      }
    } catch {
      toast.error("Initial data must be valid JSON.");
      return;
    }

    let order: string[];
    try {
      order = topologicalSort(definition);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      return;
    }

    const base = apiBase();
    const url = `${base}/runs/inline/stream`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const key = import.meta.env.VITE_WFENGINE_API_KEY;
    if (key) {
      headers["x-api-key"] = key;
    }

    setRunBusy(true);
    setRunError(null);
    setRunResult(null);
    setLastRunDefinition(definition);
    setRunLiveSteps(
      order.map((id) => {
        const n = definition.nodes.find((x) => x.id === id);
        return {
          nodeId: id,
          nodeType: n?.type ?? "?",
          status: "pending" as const,
        };
      }),
    );
    setTabs((prev) =>
      (prev ?? []).map((t) =>
        t.tabId === activeTab.tabId ? { ...t, runFailedNodeIds: [] } : t,
      ),
    );
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ definition, initialData }),
      });

      if (!res.ok) {
        const text = await res.text();
        let body: unknown;
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = text;
        }
        const msg =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error?: unknown }).error)
            : `${res.status} ${res.statusText} ${text.slice(0, 200)}`;
        setRunError(msg);
        setRunLiveSteps(null);
        toast.error("Run request failed — see Run tab");
        canvasRef.current?.setInspectorTab("run");
        return;
      }

      if (!res.body) {
        setRunError("No response body from server");
        setRunLiveSteps(null);
        canvasRef.current?.setInspectorTab("run");
        return;
      }

      await readNdjsonLines(res.body.getReader(), (obj) => {
        if (!obj || typeof obj !== "object") return;
        const o = obj as Record<string, unknown>;
        const t = o.type;
        if (t === "node_start") {
          const nodeId = String(o.nodeId ?? "");
          setRunLiveSteps((prev) =>
            prev
              ? prev.map((r) =>
                  r.nodeId === nodeId ? { ...r, status: "running" } : r,
                )
              : prev,
          );
        } else if (t === "node_complete") {
          const nodeId = String(o.nodeId ?? "");
          const ok = o.ok === true;
          const err =
            typeof o.error === "string" ? o.error : undefined;
          setRunLiveSteps((prev) =>
            prev
              ? prev.map((r) =>
                  r.nodeId === nodeId
                    ? {
                        ...r,
                        status: ok ? "ok" : "failed",
                        error: ok ? undefined : err,
                      }
                    : r,
                )
              : prev,
          );
        } else if (t === "run_finished") {
          const result = o.result as WorkflowExecuteResult;
          setRunLiveSteps(null);
          setRunResult(result);
          const errIds = Object.keys(result.errors ?? {});
          setTabs((prev) =>
            (prev ?? []).map((tab) =>
              tab.tabId === activeTab.tabId
                ? {
                    ...tab,
                    lastRunOutputs: result.outputs,
                    runFailedNodeIds: errIds,
                  }
                : tab,
            ),
          );

          if (result.status === "completed") {
            toast.success("Completed");
          } else if (result.status === "failed") {
            toast.error("Workflow failed — see Run tab");
          } else {
            toast.warning("Partial errors — see Run tab");
          }
        } else if (t === "run_error") {
          setRunLiveSteps(null);
          setRunError(String(o.message ?? "Execution failed"));
          toast.error("Workflow failed — see Run tab");
        }
      });

      canvasRef.current?.setInspectorTab("run");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRunError(msg);
      setRunLiveSteps(null);
      toast.error("Run failed — see Run tab");
      canvasRef.current?.setInspectorTab("run");
    } finally {
      setRunBusy(false);
    }
  }, [activeTab]);

  const runSingleNodeFromCache = useCallback(
    async (nodeId: string) => {
      const el = canvasRef.current;
      if (!el || !activeTab) return;
      const tabId = activeTab.tabId;
      const definition = el.exportWorkflowDefinition();
      const ancestors = collectAncestorIds(nodeId, definition.edges);
      const cache = activeTab.lastRunOutputs;
      const seedOutputs: Record<string, unknown> = {};
      if (ancestors.length > 0) {
        if (!cache || Object.keys(cache).length === 0) {
          toast.error("Run the full workflow once so upstream outputs are cached.");
          return;
        }
        for (const aid of ancestors) {
          if (!Object.prototype.hasOwnProperty.call(cache, aid)) {
            toast.error(
              `No cached output for upstream node "${aid}". Run the full workflow first.`,
            );
            return;
          }
          seedOutputs[aid] = cache[aid]!;
        }
      }

      let initialData: unknown = undefined;
      try {
        const trimmed = activeTab.initialDataRaw.trim();
        if (trimmed.length > 0) {
          initialData = JSON.parse(trimmed) as unknown;
        }
      } catch {
        toast.error("Initial data must be valid JSON.");
        return;
      }

      const base = apiBase();
      const url = `${base}/runs/inline/stream`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      const key = import.meta.env.VITE_WFENGINE_API_KEY;
      if (key) {
        headers["x-api-key"] = key;
      }

      const nodeMeta = definition.nodes.find((n) => n.id === nodeId);
      setRunBusy(true);
      setRunError(null);
      setRunResult(null);
      setLastRunDefinition(definition);
      setRunLiveSteps([
        {
          nodeId,
          nodeType: nodeMeta?.type ?? "?",
          status: "pending",
        },
      ]);
      setTabs((prev) =>
        (prev ?? []).map((t) =>
          t.tabId === tabId ? { ...t, runFailedNodeIds: [] } : t,
        ),
      );

      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            definition,
            initialData,
            singleNodeRun: { nodeId, seedOutputs },
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          let body: unknown;
          try {
            body = JSON.parse(text) as unknown;
          } catch {
            body = text;
          }
          const msg =
            typeof body === "object" && body !== null && "error" in body
              ? String((body as { error?: unknown }).error)
              : `${res.status} ${res.statusText} ${text.slice(0, 200)}`;
          setRunError(msg);
          setRunLiveSteps(null);
          toast.error("Re-run request failed — see Run tab");
          canvasRef.current?.setInspectorTab("run");
          return;
        }

        if (!res.body) {
          setRunError("No response body from server");
          setRunLiveSteps(null);
          canvasRef.current?.setInspectorTab("run");
          return;
        }

        await readNdjsonLines(res.body.getReader(), (obj) => {
          if (!obj || typeof obj !== "object") return;
          const o = obj as Record<string, unknown>;
          const ev = o.type;
          if (ev === "node_start") {
            const nid = String(o.nodeId ?? "");
            setRunLiveSteps((prev) =>
              prev
                ? prev.map((r) =>
                    r.nodeId === nid ? { ...r, status: "running" } : r,
                  )
                : prev,
            );
          } else if (ev === "node_complete") {
            const nid = String(o.nodeId ?? "");
            const ok = o.ok === true;
            const err =
              typeof o.error === "string" ? o.error : undefined;
            setRunLiveSteps((prev) =>
              prev
                ? prev.map((r) =>
                    r.nodeId === nid
                      ? {
                          ...r,
                          status: ok ? "ok" : "failed",
                          error: ok ? undefined : err,
                        }
                      : r,
                  )
                : prev,
            );
          } else if (ev === "run_finished") {
            const result = o.result as WorkflowExecuteResult;
            setRunLiveSteps(null);
            setRunResult(result);
            const errIds = Object.keys(result.errors ?? {});
            setTabs((prev) =>
              (prev ?? []).map((tab) =>
                tab.tabId === tabId
                  ? {
                      ...tab,
                      lastRunOutputs: {
                        ...(tab.lastRunOutputs ?? {}),
                        ...result.outputs,
                      },
                      runFailedNodeIds: errIds,
                    }
                  : tab,
              ),
            );

            if (result.status === "completed") {
              toast.success("Step completed");
            } else if (result.status === "failed") {
              toast.error("Step failed — see Run tab");
            } else {
              toast.warning("Partial errors — see Run tab");
            }
          } else if (ev === "run_error") {
            setRunLiveSteps(null);
            setRunError(String(o.message ?? "Execution failed"));
            toast.error("Step failed — see Run tab");
          }
        });

        canvasRef.current?.setInspectorTab("run");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setRunError(msg);
        setRunLiveSteps(null);
        toast.error("Re-run failed — see Run tab");
        canvasRef.current?.setInspectorTab("run");
      } finally {
        setRunBusy(false);
      }
    },
    [activeTab],
  );

  const onImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const raw = reader.result as string;
          const parsed = JSON.parse(raw) as unknown;
          const def = parseWorkflow(parsed);
          applyImportedWorkflow(def);
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Invalid workflow JSON",
          );
        }
      };
      reader.readAsText(file);
    },
    [applyImportedWorkflow],
  );

  const onApplyPastedJson = useCallback(() => {
    setImportPasteError(null);
    try {
      const trimmed = importPasteRaw.trim();
      if (!trimmed) {
        setImportPasteError("Paste workflow JSON first.");
        return;
      }
      const parsed = JSON.parse(trimmed) as unknown;
      const def = parseWorkflow(parsed);
      applyImportedWorkflow(def);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Invalid workflow JSON";
      setImportPasteError(msg);
      toast.error(msg);
    }
  }, [applyImportedWorkflow, importPasteRaw]);

  if (!tabs || !activeTab) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-[#0c0c10] text-zinc-400">
        <span className="text-sm">Loading Studio…</span>
      </div>
    );
  }

  const setActiveTabField = <K extends keyof Omit<StudioTab, "tabId" | "nodes" | "edges" | "dirty" | "runFailedNodeIds" | "lastRunOutputs">>(
    key: K,
    value: StudioTab[K],
  ) => {
    setTabs((prev) =>
      (prev ?? []).map((t) =>
        t.tabId === activeTab.tabId ? { ...t, [key]: value, dirty: true } : t,
      ),
    );
  };

  return (
    <div className="flex h-screen flex-col bg-[#0c0c10] text-zinc-200">
      <Toaster richColors closeButton position="top-center" theme="dark" />

      <header className="relative z-10 flex h-[52px] shrink-0 items-stretch border-b border-white/[0.06] bg-[#12121a]/95 backdrop-blur-md">
        {/* Left: brand */}
        <div className="flex min-w-0 flex-[1] items-center gap-2 pl-4 pr-2">
          <div className="flex items-baseline gap-2">
            <span className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-lg font-bold tracking-tight text-transparent">
              wfengine
            </span>
            <span className="rounded-md border border-white/[0.08] bg-[#1a1a22] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Studio
            </span>
          </div>
        </div>

        {/* Center: tabs */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center">
          <div className="pointer-events-auto flex max-w-[min(820px,62vw)] items-center gap-2 overflow-x-auto px-3">
            {tabs.map((t) => {
              const isActive = t.tabId === activeTab.tabId;
              return (
                <button
                  key={t.tabId}
                  type="button"
                  onClick={() => {
                    if (t.tabId === activeTab.tabId) return;
                    flushCanvasIntoActiveTab();
                    setActiveTabId(t.tabId);
                    setRunResult(null);
                    setRunError(null);
                    queueMicrotask(() => {
                      canvasRef.current?.replaceFlowState(t.nodes, t.edges);
                    });
                  }}
                  className={cn(
                    "group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
                    isActive
                      ? "border-violet-400/35 bg-[#1a1a22] text-zinc-100"
                      : "border-white/[0.08] bg-[#14141c] text-zinc-300 hover:border-white/[0.14] hover:bg-[#1a1a22]",
                  )}
                  title={t.workflowId}
                >
                  <span className="max-w-[180px] truncate font-[system-ui,-apple-system,sans-serif] text-[13px] font-semibold tracking-tight">
                    {t.workflowId || "untitled"}
                  </span>
                  {t.dirty ? (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-amber-400/80"
                      aria-label="Unsaved changes"
                    />
                  ) : null}
                  {tabs.length > 1 ? (
                    <span
                      className="rounded-md p-0.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        flushCanvasIntoActiveTab();
                        setTabs((prev) => {
                          if (!prev) return prev;
                          const next = prev.filter((x) => x.tabId !== t.tabId);
                          return next.length ? next : prev;
                        });
                        if (t.tabId === activeTab.tabId) {
                          const remaining = tabs.filter((x) => x.tabId !== t.tabId);
                          const nextActive = remaining[0];
                          if (nextActive) {
                            setActiveTabId(nextActive.tabId);
                            queueMicrotask(() => {
                              canvasRef.current?.replaceFlowState(
                                nextActive.nodes,
                                nextActive.edges,
                              );
                            });
                          }
                        }
                      }}
                      title="Close tab"
                      role="button"
                      tabIndex={0}
                    >
                      <X className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                flushCanvasIntoActiveTab();
                const tid = newTabId();
                const emptyNodes: Node<WfNodeData>[] = [];
                const emptyEdges: Edge[] = [];
                setTabs((prev) => [
                  ...(prev ?? []),
                  {
                    tabId: tid,
                    workflowId: `untitled-${Math.random().toString(36).slice(2, 8)}`,
                    workflowDescription: "",
                    initialDataRaw: "{}",
                    nodes: emptyNodes,
                    edges: emptyEdges,
                    dirty: true,
                    runFailedNodeIds: [],
                    lastRunOutputs: undefined,
                  },
                ]);
                setActiveTabId(tid);
                queueMicrotask(() => {
                  canvasRef.current?.replaceFlowState(emptyNodes, emptyEdges);
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#14141c] px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:border-white/[0.14] hover:bg-[#1a1a22]"
              title="New workflow tab (empty canvas)"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New</span>
            </button>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex min-w-0 flex-[1] items-center justify-end gap-1.5 pr-3 pl-2">
          <ToolbarBtn
            title="Undo"
            disabled={!hist.canUndo}
            onClick={() => canvasRef.current?.undo()}
          >
            <Undo2 className="h-4 w-4" />
          </ToolbarBtn>
          <ToolbarBtn
            title="Redo"
            disabled={!hist.canRedo}
            onClick={() => canvasRef.current?.redo()}
          >
            <Redo2 className="h-4 w-4" />
          </ToolbarBtn>

          <span className="mx-0.5 hidden h-6 w-px bg-white/10 md:inline-block" />

          <ToolbarBtn
            title="Download workflow as JSON file"
            onClick={onExport}
          >
            <Save className="h-4 w-4" />
            <span className="hidden lg:inline">Export</span>
          </ToolbarBtn>
          <ToolbarBtn
            title="Save to this browser (survives refresh on this device)"
            onClick={onSaveToBrowser}
          >
            <HardDrive className="h-4 w-4" />
            <span className="hidden lg:inline">Save</span>
          </ToolbarBtn>
          <ToolbarBtn
            title="Open saved workflows (local drafts)"
            onClick={() => {
              setLibraryRefresh((n) => n + 1);
              setLibraryOpen(true);
            }}
          >
            <FolderOpen className="h-4 w-4" />
            <span className="hidden lg:inline">Library</span>
          </ToolbarBtn>
          <ToolbarBtn
            title="Publish this workflow to the server (create version)"
            onClick={async () => {
              const el = canvasRef.current;
              if (!el || !activeTab) return;
              try {
                const definition = el.exportWorkflowDefinition();
                setRunBusy(true);
                let wfId = activeTab.remoteWorkflowId;
                if (!wfId) {
                  const created = await createServerWorkflow(
                    activeTab.workflowId || "workflow",
                  );
                  wfId = created.id;
                }
                const ver = await createServerWorkflowVersion(
                  wfId,
                  definition,
                  "studio",
                );
                setTabs((prev) =>
                  (prev ?? []).map((t) =>
                    t.tabId === activeTab.tabId
                      ? {
                          ...t,
                          remoteWorkflowId: wfId,
                          remoteVersionId: ver.id,
                        }
                      : t,
                  ),
                );
                toast.success(
                  `Published to server (workflow ${wfId}, v${ver.versionNumber})`,
                );
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e));
              } finally {
                setRunBusy(false);
              }
            }}
          >
            <CloudUpload className="h-4 w-4" />
            <span className="hidden lg:inline">Publish</span>
          </ToolbarBtn>
          <ToolbarBtn
            title="Import workflow JSON (paste or file)"
            onClick={() => {
              setImportPasteError(null);
              setImportDialogOpen(true);
            }}
          >
            <Upload className="h-4 w-4" />
            <span className="hidden lg:inline">Import</span>
          </ToolbarBtn>

          <span className="mx-0.5 hidden h-6 w-px bg-white/10 md:inline-block" />

          <button
            type="button"
            disabled={runBusy}
            onClick={() => void runWorkflow()}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-gradient-to-r from-[#9d4fab] to-[#3b82f6] px-4 py-2 text-sm font-semibold text-white shadow-[0_2px_14px_rgba(59,130,246,0.18)] transition hover:brightness-[1.06] disabled:opacity-60"
          >
            <Play className="h-4 w-4 fill-current" />
            {runBusy ? "Running…" : "Run"}
          </button>
        </div>

        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onImportFile}
        />
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <WorkflowCanvas
          ref={canvasRef}
          workflowId={activeTab.workflowId}
          version={1}
          palette={STUDIO_PALETTE}
          initialNodes={activeTab.nodes}
          initialEdges={activeTab.edges}
          onExport={() => undefined}
          onReRunNodeWithCache={runSingleNodeFromCache}
          onHistoryChange={setHist}
          renderPaletteIcon={(meta) => <PaletteGlyph meta={meta} />}
          renderWorkflowInspector={() => (
            <WorkflowInspectorPanel
              workflowId={activeTab.workflowId}
              onWorkflowIdChange={(v) => setActiveTabField("workflowId", v)}
              workflowDescription={activeTab.workflowDescription}
              onWorkflowDescriptionChange={(v) =>
                setActiveTabField("workflowDescription", v)
              }
              initialDataRaw={activeTab.initialDataRaw}
              onInitialDataRawChange={(v) => setActiveTabField("initialDataRaw", v)}
            />
          )}
          renderInspector={(inspectorProps) => (
            <div className="space-y-3">
              <NodeConfigPanel {...inspectorProps} />
            </div>
          )}
          renderRunPanel={() => (
            <RunInspectorPanel
              runResult={runResult}
              runError={runError}
              workflowDefinition={lastRunDefinition}
              liveSteps={runLiveSteps}
              runBusy={runBusy}
              onClear={() => {
                setRunResult(null);
                setRunError(null);
                setLastRunDefinition(null);
                setRunLiveSteps(null);
                setTabs((prev) =>
                  (prev ?? []).map((t) =>
                    t.tabId === activeTab.tabId
                      ? {
                          ...t,
                          runFailedNodeIds: [],
                          lastRunOutputs: undefined,
                        }
                      : t,
                  ),
                );
              }}
              onOpenModal={() => setRunOpen(true)}
            />
          )}
          className="min-h-0"
          runFailedNodeIds={activeTab.runFailedNodeIds}
        />
      </div>

      <Dialog.Root
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open);
          if (!open) setImportPasteError(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(640px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/[0.08] bg-[#13131a] p-6 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
              <ClipboardPaste className="h-5 w-5 text-violet-400/90" />
              Import workflow JSON
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-zinc-400">
              Paste a full workflow definition (same shape as Export). Must
              include{" "}
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-zinc-300">
                id
              </code>
              ,{" "}
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-zinc-300">
                nodes
              </code>
              , and{" "}
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-zinc-300">
                edges
              </code>
              .
            </Dialog.Description>
            <textarea
              value={importPasteRaw}
              onChange={(e) => {
                setImportPasteRaw(e.target.value);
                setImportPasteError(null);
              }}
              spellCheck={false}
              autoComplete="off"
              placeholder={`{\n  "id": "my-workflow",\n  "version": 1,\n  "nodes": [...],\n  "edges": [...]\n}`}
              className="mt-4 min-h-[220px] w-full resize-y rounded-lg border border-white/[0.1] bg-[#0c0c10] p-3 font-mono text-xs leading-relaxed text-zinc-200 outline-none ring-violet-400/15 placeholder:text-zinc-600 focus:border-violet-400/45 focus:ring-2"
            />
            {importPasteError ? (
              <p className="mt-2 text-sm text-rose-400">{importPasteError}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
              <button
                type="button"
                onClick={() => void onApplyPastedJson()}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#9d4fab] to-[#3b82f6] px-4 py-2 text-sm font-semibold text-white shadow-[0_2px_14px_rgba(59,130,246,0.18)] transition hover:brightness-[1.06]"
              >
                Apply to canvas
              </button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-zinc-200 hover:bg-violet-950/50"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <span className="mx-1 hidden text-zinc-600 sm:inline">·</span>
              <button
                type="button"
                title="Load from .json file"
                onClick={() => importRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#1a1a22] px-3 py-2 text-sm text-zinc-300 hover:border-white/[0.18] hover:bg-[#22222c]"
              >
                <FileUp className="h-4 w-4" />
                Choose file…
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={libraryOpen} onOpenChange={setLibraryOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(760px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/[0.08] bg-[#13131a] p-6 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
              <FolderOpen className="h-5 w-5 text-violet-400/90" />
              Workflow Library
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-zinc-400">
              Local drafts are saved in this browser. Open one into a new tab.
            </Dialog.Description>

            <div className="mt-4 rounded-xl border border-white/[0.08] bg-[#0f0f15]">
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Local drafts
                </p>
                <button
                  type="button"
                  onClick={() => setLibraryRefresh((n) => n + 1)}
                  className="rounded-lg border border-white/[0.1] bg-[#1a1a22] px-3 py-1.5 text-xs text-zinc-300 hover:border-white/[0.14] hover:bg-[#22222c]"
                >
                  Refresh
                </button>
              </div>

              {localWorkspaces.length ? (
                <div className="max-h-[52vh] overflow-auto">
                  {localWorkspaces.map((m) => (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-3 first:border-t-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-100">
                          {m.title || m.workflowId || "untitled"}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                          {m.workflowId} · saved {new Date(m.savedAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openLocalWorkspaceInNewTab(m.id)}
                          className="rounded-lg bg-gradient-to-r from-[#9d4fab] to-[#3b82f6] px-3 py-2 text-xs font-semibold text-white shadow-[0_2px_14px_rgba(59,130,246,0.18)] transition hover:brightness-[1.06]"
                        >
                          Open in tab
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            deleteWorkspace(m.id);
                            setLibraryRefresh((n) => n + 1);
                            toast.success("Deleted local draft");
                          }}
                          className="rounded-lg border border-white/15 px-3 py-2 text-xs text-zinc-200 hover:bg-rose-950/40"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-sm text-zinc-400">
                  No local drafts yet. Click <span className="font-semibold text-zinc-200">Save</span> to store one.
                </div>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-white/[0.08] bg-[#0f0f15]">
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Server workflows
                </p>
                <button
                  type="button"
                  onClick={() => setLibraryRefresh((n) => n + 1)}
                  className="rounded-lg border border-white/[0.1] bg-[#1a1a22] px-3 py-1.5 text-xs text-zinc-300 hover:border-white/[0.14] hover:bg-[#22222c]"
                >
                  Refresh
                </button>
              </div>

              {serverBusy ? (
                <div className="px-4 py-6 text-sm text-zinc-400">Loading…</div>
              ) : serverError ? (
                <div className="px-4 py-6 text-sm text-rose-300">
                  {serverError}
                </div>
              ) : serverWorkflows.length ? (
                <div className="max-h-[42vh] overflow-auto">
                  {serverWorkflows.map((wf) => {
                    const latest = wf.versions?.[0];
                    return (
                      <div
                        key={wf.id}
                        className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-3 first:border-t-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-100">
                            {wf.name}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                            {wf.id}
                            {latest
                              ? ` · latest v${latest.versionNumber}`
                              : " · no versions"}
                          </p>
                        </div>
                        {latest ? (
                          <button
                            type="button"
                            onClick={async () => {
                              // Load by version id into a new tab.
                              try {
                                const ver = await getServerWorkflowVersion(latest.id);
                                const def = parseWorkflow(ver.definitionJson);
                                applyImportedWorkflow(def);
                                toast.success("Opened server workflow version in a new tab");
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : String(e));
                              }
                            }}
                            className="rounded-lg border border-white/[0.12] bg-[#1a1a22] px-3 py-2 text-xs text-zinc-200 hover:border-white/[0.18] hover:bg-[#22222c]"
                          >
                            Open latest
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-4 py-6 text-sm text-zinc-400">
                  No workflows found on the server yet. Use{" "}
                  <span className="font-semibold text-zinc-200">Publish</span>{" "}
                  to create one.
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-zinc-200 hover:bg-violet-950/50"
                >
                  Close
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={runOpen} onOpenChange={setRunOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(720px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/[0.08] bg-[#13131a] p-6 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <Dialog.Title className="flex flex-wrap items-center gap-2 text-lg font-semibold text-zinc-100">
              Execution result
              {runResult && !runError ? (
                runResult.status === "completed" ? (
                  <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-400/35">
                    completed
                  </span>
                ) : runResult.status === "failed" ? (
                  <span className="rounded-md bg-rose-500/25 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-200 ring-1 ring-rose-400/40">
                    failed
                  </span>
                ) : (
                  <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-200 ring-1 ring-amber-400/35">
                    partial
                  </span>
                )
              ) : null}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Workflow run output from the API
            </Dialog.Description>
            <div className="mt-4 max-h-[60vh] overflow-auto rounded-lg border border-white/[0.08] bg-[#1a1a22] p-4 font-mono text-xs leading-relaxed text-zinc-300">
              {runError ? (
                <span className="text-rose-400">{runError}</span>
              ) : (
                <pre className="m-0 whitespace-pre-wrap break-all">
                  {JSON.stringify(runResult, null, 2)}
                </pre>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-zinc-200 hover:bg-violet-950/50"
                >
                  Close
                </button>
              </Dialog.Close>
              {!runError && runResult ? (
                <button
                  type="button"
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-zinc-200 hover:bg-violet-950/50"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      JSON.stringify(runResult, null, 2),
                    );
                    toast.success("Copied to clipboard");
                  }}
                >
                  Copy JSON
                </button>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <footer className="shrink-0 border-t border-white/[0.06] px-4 py-2 text-center text-[11px] leading-snug text-zinc-500">
        wfengine Studio · Save stores this workflow in your browser (localStorage) ·
        Drag to pan · Shift+drag to multi-select · Ctrl+C / Ctrl+V nodes · Fit & zoom
        on canvas controls
      </footer>
    </div>
  );
}

function ToolbarBtn(props: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}): ReactElement {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#1a1a22] px-2.5 py-1.5 text-xs font-medium text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-white/[0.14] hover:bg-[#22222c] disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}
