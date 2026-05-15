import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileDown,
  Inbox,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { toast } from "sonner";

export type JsonResultViewerPayload = {
  /** Node id (shown in title and download filename). */
  nodeId: string;
  variant: "output" | "error";
  /** Workflow node type, e.g. `mfa.agentGroup` */
  nodeTypeLabel?: string;
  /** Raw value — objects/arrays get tree view; strings shown as text */
  data: unknown;
};

/** Collect plausible file references from stringified JSON (runner-local paths). */
function extractPathHints(jsonStr: string): string[] {
  const seen = new Set<string>();
  const patterns = [
    /"path"\s*:\s*"([^"]+\.(?:csv|txt|json|ndjson|xlsx))"/gi,
    /"reports\/[^"]+"/gi,
    /\/[\w./-]+\.(?:csv|txt|json)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(jsonStr)) !== null) {
      const s = (m[1] ?? m[0]).replace(/^"|"$/g, "");
      if (s.length > 2 && s.length < 500) seen.add(s);
    }
  }
  return [...seen];
}

/** Shallow+deep filter: keep branches that match query (key path or primitive value). */
function filterJsonForSearch(obj: unknown, query: string): unknown {
  const q = query.trim().toLowerCase();
  if (!q) return obj;

  function walk(v: unknown): unknown | undefined {
    if (v === null || v === undefined) {
      return String(v).toLowerCase().includes(q) ? v : undefined;
    }
    if (typeof v === "string") {
      return v.toLowerCase().includes(q) ? v : undefined;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      return String(v).toLowerCase().includes(q) ? v : undefined;
    }
    if (Array.isArray(v)) {
      const next = v.map(walk).filter((x) => x !== undefined);
      return next.length ? next : undefined;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      let any = false;
      for (const [k, val] of Object.entries(o)) {
        if (k.toLowerCase().includes(q)) {
          out[k] = val;
          any = true;
          continue;
        }
        const w = walk(val);
        if (w !== undefined) {
          out[k] = w;
          any = true;
        }
      }
      return any ? out : undefined;
    }
    return undefined;
  }

  const r = walk(obj);
  return r === undefined ? { _note: "No matches — clear search to see full output." } : r;
}

function JsonTreeNode(props: {
  name: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <div className="font-mono text-[12px] leading-relaxed">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-1 rounded px-0.5 py-0.5 text-left text-zinc-300 hover:bg-white/[0.04]"
      >
        <span className="mt-0.5 shrink-0 text-zinc-500">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">{props.name}</span>
      </button>
      {open ? (
        <div className="ml-4 border-l border-white/[0.07] pl-2">{props.children}</div>
      ) : null}
    </div>
  );
}

function JsonLeaf(props: { value: unknown }): ReactElement {
  const v = props.value;
  if (v === null) {
    return <span className="text-zinc-500">null</span>;
  }
  if (v === undefined) {
    return <span className="text-zinc-500">undefined</span>;
  }
  if (typeof v === "boolean") {
    return <span className="text-amber-300/95">{String(v)}</span>;
  }
  if (typeof v === "number") {
    return <span className="text-cyan-300/95">{v}</span>;
  }
  if (typeof v === "string") {
    const s = v.length > 8000 ? `${v.slice(0, 7997)}…` : v;
    return (
      <span className="break-all text-emerald-200/90">
        {JSON.stringify(s)}
      </span>
    );
  }
  return <span className="text-zinc-400">{String(v)}</span>;
}

function JsonTreeInner(props: {
  data: unknown;
  depth: number;
  maxAutoDepth: number;
}): ReactElement {
  const { data, depth, maxAutoDepth } = props;

  if (data === null || data === undefined) {
    return <JsonLeaf value={data} />;
  }
  if (typeof data !== "object") {
    return <JsonLeaf value={data} />;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="text-zinc-500">[]</span>;
    }
    const defaultOpen = depth < maxAutoDepth;
    return (
      <JsonTreeNode
        defaultOpen={defaultOpen}
        name={
          <span className="text-violet-300/85">
            [ array · {data.length} item{data.length === 1 ? "" : "s"} ]
          </span>
        }
      >
        <div className="space-y-0.5">
          {data.map((item, i) => (
            <div key={i} className="flex flex-wrap gap-x-2">
              <span className="shrink-0 text-violet-400/80">{i}:</span>
              <div className="min-w-0 flex-1">
                <JsonTreeInner
                  data={item}
                  depth={depth + 1}
                  maxAutoDepth={maxAutoDepth}
                />
              </div>
            </div>
          ))}
        </div>
      </JsonTreeNode>
    );
  }

  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) {
    return <span className="text-zinc-500">{"{}"}</span>;
  }

  return (
    <div className="ml-0 border-l border-white/[0.06] pl-2">
      <div className="ml-1 space-y-0.5 border-l border-white/[0.04] pl-2">
        {entries.map(([k, val]) => {
          const isNested =
            val !== null &&
            typeof val === "object" &&
            (Array.isArray(val)
              ? val.length > 0
              : Object.keys(val as object).length > 0);
          const defaultOpen = depth < maxAutoDepth;
          if (!isNested) {
            return (
              <div key={k} className="flex flex-wrap gap-x-2 break-all">
                <span className="shrink-0 text-sky-300/90">&quot;{k}&quot;:</span>
                <JsonLeaf value={val} />
              </div>
            );
          }
          return (
            <JsonTreeNode
              key={k}
              defaultOpen={defaultOpen}
              name={<span className="text-sky-300/90">&quot;{k}&quot;:</span>}
            >
              <JsonTreeInner
                data={val}
                depth={depth + 1}
                maxAutoDepth={maxAutoDepth}
              />
            </JsonTreeNode>
          );
        })}
      </div>
    </div>
  );
}

function highlightSearchInText(text: string, query: string): ReactElement {
  const q = query.trim();
  if (!q) {
    return <>{text}</>;
  }
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark
            key={i}
            className="rounded bg-amber-500/35 px-0.5 text-amber-100"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** If `data` is a string that looks like JSON, parse for tree view; keep original for raw text. */
function effectiveTreeSource(data: unknown): unknown {
  if (typeof data !== "string") return data;
  const t = data.trim();
  if (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  ) {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return data;
    }
  }
  return data;
}

/** Minimal JSON-ish highlighting for raw panel */
function RawJsonPanel(props: {
  text: string;
  searchQuery: string;
  tone?: "default" | "error";
}): ReactElement {
  const err = props.tone === "error";
  const lines = props.text.split("\n");
  return (
    <pre
      className={`max-h-[min(76vh,900px)] overflow-auto whitespace-pre font-mono text-[11px] leading-relaxed ${
        err ? "text-rose-50/95" : "text-zinc-300"
      }`}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className={err ? "hover:bg-rose-950/35" : "hover:bg-white/[0.02]"}
        >
          <span
            className={`inline-block w-10 shrink-0 select-none pr-2 text-right ${
              err ? "text-rose-500/75" : "text-zinc-600"
            }`}
          >
            {i + 1}
          </span>
          <span className={err ? "text-rose-600/80" : "text-zinc-500"}>
            &nbsp;
          </span>
          {highlightSearchInText(line, props.searchQuery)}
        </div>
      ))}
    </pre>
  );
}

function filenameSlug(nodeId: string): string {
  const s = nodeId.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return s.length ? s : "node";
}

function isPayloadContentEmpty(data: unknown, pretty: string): boolean {
  if (data === null || data === undefined) return true;
  if (typeof data === "string" && data.trim() === "") return true;
  if (Array.isArray(data) && data.length === 0) return true;
  if (
    typeof data === "object" &&
    !Array.isArray(data) &&
    Object.keys(data).length === 0
  ) {
    return true;
  }
  const t = pretty.trim();
  return t === "" || t === "undefined";
}

function triggerDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Downloaded ${filename}`);
}

export function JsonResultViewerModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: JsonResultViewerPayload | null;
}): ReactElement {
  const { open, onOpenChange, payload } = props;
  const [mode, setMode] = useState<"tree" | "raw">("tree");
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setMode("tree");
    }
  }, [open]);

  /** When the modal opens, default to Tree for valid JSON (objects / arrays). */
  useEffect(() => {
    if (open && !wasOpenRef.current && payload) {
      const ts = effectiveTreeSource(payload.data);
      const structured =
        ts !== null && typeof ts === "object" && ts !== undefined;
      if (structured) setMode("tree");
    }
    wasOpenRef.current = open;
  }, [open, payload]);

  useEffect(() => {
    if (!open) return;
    const onDocKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onDocKey, true);
    return () => document.removeEventListener("keydown", onDocKey, true);
  }, [open]);

  const pretty = useMemo(() => {
    if (!payload) return "";
    try {
      if (typeof payload.data === "string") return payload.data;
      if (payload.data === undefined) return "undefined";
      const j = JSON.stringify(payload.data, null, 2);
      return j ?? String(payload.data);
    } catch {
      return String(payload.data);
    }
  }, [payload]);

  const treeSource = useMemo(() => {
    if (!payload) return null;
    return effectiveTreeSource(payload.data);
  }, [payload]);

  const isTreeStructured =
    treeSource !== null &&
    typeof treeSource === "object" &&
    treeSource !== undefined;

  const filteredData = useMemo(() => {
    if (!payload || treeSource === null) return null;
    if (typeof treeSource === "string") return treeSource;
    return filterJsonForSearch(treeSource, search);
  }, [payload, treeSource, search]);

  const pathHints = useMemo(() => extractPathHints(pretty), [pretty]);

  const isErrorView = payload?.variant === "error";

  const headerTitle = useMemo(() => {
    if (!payload) return "Result";
    const kind = payload.variant === "error" ? "Error" : "Output";
    return `${payload.nodeId} · ${kind}`;
  }, [payload]);

  const isEmpty = useMemo(
    () => Boolean(payload) && isPayloadContentEmpty(payload!.data, pretty),
    [payload, pretty],
  );

  const copyPretty = useCallback(() => {
    if (!payload) return;
    void navigator.clipboard.writeText(pretty);
    toast.success("Copied to clipboard");
  }, [payload, pretty]);

  const downloadFile = useCallback(() => {
    if (!payload) return;
    const base = filenameSlug(payload.nodeId);
    if (payload.variant === "error") {
      const name = `${base}-error.txt`;
      triggerDownload(name, pretty, "text/plain;charset=utf-8");
      return;
    }
    const name = `${base}-output.json`;
    triggerDownload(name, pretty, "application/json;charset=utf-8");
  }, [payload, pretty]);

  const copyPath = useCallback((p: string) => {
    void navigator.clipboard.writeText(p);
    toast.success("Path copied");
  }, []);

  const titleId = "json-viewer-modal-title";
  const headerTone = isErrorView
    ? "border-rose-500/25 from-rose-950/50 to-[#1a1218]"
    : "border-white/[0.08] from-violet-950/40 to-[#12121a]";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-labelledby={titleId}
          className="fixed left-1/2 top-1/2 z-[91] flex max-h-[92vh] w-[min(96vw,1400px)] min-w-[min(1200px,96vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0c0c12] shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div
            className={`flex shrink-0 flex-wrap items-start justify-between gap-3 border-b bg-gradient-to-r px-4 py-3 ${headerTone}`}
          >
            <div className="min-w-0">
              <Dialog.Title
                id={titleId}
                className={`flex items-center gap-2 text-base font-semibold ${
                  isErrorView ? "text-rose-100" : "text-zinc-100"
                }`}
              >
                {isErrorView ? (
                  <AlertTriangle
                    className="h-5 w-5 shrink-0 text-rose-400"
                    aria-hidden
                  />
                ) : (
                  <Braces className="h-5 w-5 shrink-0 text-violet-400" aria-hidden />
                )}
                <span className="truncate">{headerTitle}</span>
              </Dialog.Title>
              {payload?.nodeTypeLabel ? (
                <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                  {payload.nodeTypeLabel}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-zinc-500" />
                <input
                  ref={searchInputRef}
                  type="search"
                  placeholder="Search in output…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-[min(260px,42vw)] rounded-lg border border-white/[0.1] bg-black/40 py-1.5 pl-8 pr-2 text-[12px] text-zinc-200 outline-none ring-violet-400/20 placeholder:text-zinc-600 focus:border-violet-500/40 focus:ring-2"
                  aria-label="Search in result"
                />
              </div>
              {payload && isTreeStructured ? (
                <div className="flex rounded-lg bg-black/35 p-0.5 ring-1 ring-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setMode("tree")}
                    className={`rounded-md px-3 py-1 text-[11px] font-medium ${
                      mode === "tree"
                        ? "bg-violet-600 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Tree
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("raw")}
                    className={`rounded-md px-3 py-1 text-[11px] font-medium ${
                      mode === "raw"
                        ? "bg-violet-600 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Raw
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => copyPretty()}
                disabled={!payload}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#1a1a22] px-3 py-1.5 text-[11px] font-medium text-zinc-200 hover:bg-[#22222c] disabled:opacity-40"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Copy
              </button>
              <button
                type="button"
                onClick={() => downloadFile()}
                disabled={!payload || isEmpty}
                title={
                  isErrorView
                    ? "Download error text as .txt"
                    : "Download pretty-printed JSON"
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-1.5 text-[11px] font-medium text-emerald-100/95 hover:bg-emerald-950/45 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                {isErrorView ? "Download" : "Download as JSON"}
              </button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {pathHints.length > 0 && !isErrorView ? (
            <div className="shrink-0 border-b border-white/[0.06] bg-[#101018] px-4 py-2">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Paths in output (copy for runner / IDE)
              </p>
              <div className="flex flex-wrap gap-2">
                {pathHints.slice(0, 8).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => copyPath(p)}
                    className="inline-flex max-w-full items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-950/25 px-2 py-1 text-[10px] font-mono text-emerald-200/90 hover:bg-emerald-950/40"
                  >
                    <FileDown className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
                    <span className="truncate">{p}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-zinc-600">
                Files live on the workflow runner — use Copy, then open where the worker wrote them.
              </p>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            {!payload ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Inbox className="h-12 w-12 text-zinc-600" aria-hidden />
                <p className="max-w-sm text-sm text-zinc-400">
                  No run data to show. Run the workflow and open a node result again.
                </p>
              </div>
            ) : isEmpty ? (
              <div
                className={`flex flex-col items-center justify-center gap-3 rounded-xl border px-6 py-16 text-center ${
                  isErrorView
                    ? "border-rose-500/25 bg-rose-950/20"
                    : "border-zinc-700/40 bg-zinc-950/40"
                }`}
              >
                {isErrorView ? (
                  <>
                    <AlertTriangle
                      className="h-12 w-12 text-rose-400/90"
                      aria-hidden
                    />
                    <p className="max-w-md text-sm leading-relaxed text-rose-100/90">
                      No error message was captured for this node. Check the live
                      progress list or server logs for details.
                    </p>
                  </>
                ) : (
                  <>
                    <Inbox className="h-12 w-12 text-zinc-500" aria-hidden />
                    <p className="max-w-md text-sm leading-relaxed text-zinc-400">
                      This node produced no output (empty object, empty string, or
                      null). If you expected data, verify the node configuration
                      and upstream inputs.
                    </p>
                  </>
                )}
              </div>
            ) : !isTreeStructured ? (
              <div
                className={
                  isErrorView
                    ? "rounded-xl border border-rose-500/30 bg-rose-950/25 p-3"
                    : ""
                }
              >
                <RawJsonPanel
                  text={pretty}
                  searchQuery={search}
                  tone={isErrorView ? "error" : "default"}
                />
              </div>
            ) : mode === "raw" ? (
              <RawJsonPanel
                text={
                  search.trim()
                    ? JSON.stringify(filteredData, null, 2)
                    : pretty
                }
                searchQuery={search}
                tone="default"
              />
            ) : (
              <div className="max-h-[min(76vh,900px)] overflow-auto rounded-xl border border-white/[0.06] bg-black/25 p-3">
                <JsonTreeInner
                  data={search.trim() ? filteredData : treeSource}
                  depth={0}
                  maxAutoDepth={3}
                />
              </div>
            )}
          </div>

          <div
            className={`shrink-0 border-t px-4 py-2 text-center text-[10px] ${
              isErrorView
                ? "border-rose-500/20 bg-rose-950/25 text-rose-300/70"
                : "border-white/[0.06] bg-[#08080c] text-zinc-600"
            }`}
          >
            {isErrorView ? (
              <>
                Esc closes ·{" "}
                <kbd className="rounded border border-rose-500/30 bg-rose-950/40 px-1 py-0.5 font-mono text-[9px]">
                  ⌃F
                </kbd>{" "}
                /{" "}
                <kbd className="rounded border border-rose-500/30 bg-rose-950/40 px-1 py-0.5 font-mono text-[9px]">
                  ⌘F
                </kbd>{" "}
                focuses search.
              </>
            ) : (
              <>
                Tree view is the default for JSON — switch to Raw for line-by-line
                copy. Esc closes ·{" "}
                <kbd className="rounded border border-white/[0.12] bg-black/40 px-1 py-0.5 font-mono text-[9px]">
                  ⌃F
                </kbd>{" "}
                /{" "}
                <kbd className="rounded border border-white/[0.12] bg-black/40 px-1 py-0.5 font-mono text-[9px]">
                  ⌘F
                </kbd>{" "}
                focuses search.
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
