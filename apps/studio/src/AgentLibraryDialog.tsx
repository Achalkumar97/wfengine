import {
  AgentLibraryDocumentSchema,
  type AgentLibraryDocument,
  type AgentLibraryEntry,
} from "@wfengine/nodes-agents/schemas";
import type { WfNodeData } from "@wfengine/ui";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Bot,
  Download,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import type { Node } from "reactflow";
import { toast } from "sonner";
import { countWorkflowsUsingAgent } from "./agent-library-usage.js";
import { createAgentEntry } from "./agent-library-storage.js";

const label =
  "mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500";
const input =
  "w-full rounded-xl border border-white/[0.08] bg-[#1a1a22] px-2.5 py-1.5 text-sm text-zinc-200 outline-none ring-violet-400/15 focus:border-violet-400/45 focus:ring-2";

/** First two lines of prompt, for card preview (line-clamp-2 in UI). */
function promptFirstTwoLines(text: string): string {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return "—";
  if (lines.length === 1) {
    const t = lines[0]!;
    return t.length > 200 ? `${t.slice(0, 199)}…` : t;
  }
  return `${lines[0]}\n${lines[1]}`;
}

export function AgentLibraryDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryDocument: AgentLibraryDocument;
  onDocumentChange: (doc: AgentLibraryDocument) => void;
  /** Open Studio tabs (or any workflow snapshots) to count “used in N workflows”. */
  workflowsForUsage?: readonly { nodes: Node<WfNodeData>[] }[];
}): ReactElement {
  const { open, onOpenChange, libraryDocument, onDocumentChange } = props;
  const workflowsForUsage = props.workflowsForUsage ?? [];

  const [draftName, setDraftName] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftModel, setDraftModel] = useState("gpt-4o-mini");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showComposer, setShowComposer] = useState(false);

  useEffect(() => {
    if (!open) {
      setDraftName("");
      setDraftPrompt("");
      setDraftModel("gpt-4o-mini");
      setEditingId(null);
      setImportErr(null);
      setSearch("");
      setShowComposer(false);
    }
  }, [open]);

  const saveEntry = useCallback(
    (entry: AgentLibraryEntry) => {
      const others = libraryDocument.agents.filter((a) => a.id !== entry.id);
      onDocumentChange({
        ...libraryDocument,
        agents: [...others, entry].sort((a, b) => a.name.localeCompare(b.name)),
      });
      toast.success("Agent saved");
    },
    [libraryDocument, onDocumentChange],
  );

  const deleteEntry = useCallback(
    (id: string) => {
      onDocumentChange({
        ...libraryDocument,
        agents: libraryDocument.agents.filter((a) => a.id !== id),
      });
      toast.success("Agent removed");
    },
    [libraryDocument, onDocumentChange],
  );

  const startEdit = useCallback((e: AgentLibraryEntry) => {
    setShowComposer(true);
    setEditingId(e.id);
    setDraftName(e.name);
    setDraftPrompt(e.systemPrompt);
    setDraftModel(e.model ?? "gpt-4o-mini");
  }, []);

  const startCreate = useCallback(() => {
    setShowComposer(true);
    setEditingId(null);
    setDraftName("");
    setDraftPrompt("");
    setDraftModel("gpt-4o-mini");
  }, []);

  const applyEdit = useCallback(() => {
    if (!editingId || !draftName.trim() || !draftPrompt.trim()) {
      toast.error("Name and system prompt required");
      return;
    }
    const existing = libraryDocument.agents.find((a) => a.id === editingId);
    saveEntry(
      createAgentEntry({
        id: editingId,
        name: draftName.trim(),
        systemPrompt: draftPrompt.trim(),
        model: draftModel.trim() || "gpt-4o-mini",
        defaultTools: existing?.defaultTools,
        provider: existing?.provider,
      }),
    );
    setEditingId(null);
    setShowComposer(false);
  }, [
    editingId,
    draftName,
    draftPrompt,
    draftModel,
    libraryDocument.agents,
    saveEntry,
  ]);

  const addNew = useCallback(() => {
    if (!draftName.trim() || !draftPrompt.trim()) {
      toast.error("Name and system prompt required");
      return;
    }
    saveEntry(
      createAgentEntry({
        name: draftName.trim(),
        systemPrompt: draftPrompt.trim(),
        model: draftModel.trim() || "gpt-4o-mini",
      }),
    );
    setDraftName("");
    setDraftPrompt("");
    setDraftModel("gpt-4o-mini");
    setShowComposer(false);
  }, [draftName, draftPrompt, draftModel, saveEntry]);

  const onImportFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const raw = JSON.parse(String(reader.result)) as unknown;
          const p = AgentLibraryDocumentSchema.safeParse(raw);
          if (!p.success) {
            setImportErr(p.error.message);
            return;
          }
          onDocumentChange(p.data);
          setImportErr(null);
          toast.success("Imported agent library");
        } catch (e) {
          setImportErr(e instanceof Error ? e.message : String(e));
        }
      };
      reader.readAsText(file);
    },
    [onDocumentChange],
  );

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return libraryDocument.agents;
    return libraryDocument.agents.filter((a) => {
      const blob = `${a.name} ${a.id} ${a.model} ${a.systemPrompt}`.toLowerCase();
      return blob.includes(q);
    });
  }, [libraryDocument.agents, search]);

  const titleId = "agent-library-dashboard-title";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[50] bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-labelledby={titleId}
          className="fixed left-1/2 top-1/2 z-[50] max-h-[min(900px,94vh)] w-[min(1100px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0b0b10] shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          {/* Header */}
          <div className="relative overflow-hidden border-b border-white/[0.08] bg-gradient-to-br from-violet-950/80 via-[#12121a] to-[#0b0b10] px-6 pb-5 pt-6">
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-violet-500/20 blur-3xl" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <Dialog.Title
                  id={titleId}
                  className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-white"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-indigo-600/20 ring-1 ring-violet-400/25">
                    <Bot className="h-6 w-6 text-violet-200" aria-hidden />
                  </span>
                  <span>Agent Library</span>
                </Dialog.Title>
                <Dialog.Description className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
                  Reusable personas for AI steps. Stored in this browser (
                  <span className="font-mono text-zinc-500">localStorage</span>
                  ). Export JSON to share across machines or teams.
                </Dialog.Description>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                <button
                  type="button"
                  onClick={startCreate}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_30px_-6px_rgba(139,92,246,0.55)] transition hover:brightness-110"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Create New Agent
                </button>
                <button
                  type="button"
                  title="Import JSON"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/[0.14] bg-white/[0.05] px-3 py-2.5 text-sm text-zinc-200 transition hover:bg-white/[0.09]"
                  onClick={() => {
                    const inp = document.createElement("input");
                    inp.type = "file";
                    inp.accept = "application/json,.json";
                    inp.onchange = () => {
                      const f = inp.files?.[0];
                      if (f) void onImportFile(f);
                    };
                    inp.click();
                  }}
                >
                  <Upload className="h-4 w-4" aria-hidden />
                  Import
                </button>
                <button
                  type="button"
                  title="Export JSON"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/[0.14] bg-white/[0.05] px-3 py-2.5 text-sm text-zinc-200 transition hover:bg-white/[0.09]"
                  onClick={() => {
                    const blob = new Blob(
                      [JSON.stringify(libraryDocument, null, 2)],
                      { type: "application/json" },
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "wfengine-agent-library.json";
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success("Downloaded");
                  }}
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Export
                </button>
              </div>
            </div>

            <div className="relative mt-6">
              <div className="flex items-center gap-3 rounded-xl border border-white/[0.12] bg-black/35 px-4 py-3 ring-1 ring-white/[0.04]">
                <Search className="h-5 w-5 shrink-0 text-zinc-500" aria-hidden />
                <input
                  type="search"
                  placeholder="Search agents by name, model, or prompt…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-zinc-100 outline-none placeholder:text-zinc-600"
                  autoComplete="off"
                />
                <span className="hidden shrink-0 rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-zinc-500 sm:inline">
                  {filteredAgents.length} / {libraryDocument.agents.length}
                </span>
              </div>
            </div>
            {importErr ? (
              <p className="relative mt-3 text-sm text-rose-400">{importErr}</p>
            ) : null}
          </div>

          {/* Composer */}
          {showComposer ? (
            <div className="border-b border-white/[0.06] bg-[#101018] px-6 py-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-violet-300/90">
                  {editingId ? "Edit agent" : "New agent"}
                </p>
                <button
                  type="button"
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                  onClick={() => {
                    setShowComposer(false);
                    setEditingId(null);
                  }}
                >
                  Close editor
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={label}>Name</label>
                  <input
                    className={input}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="e.g. Research bot"
                  />
                </div>
                <div>
                  <label className={label}>Model</label>
                  <input
                    className={input}
                    value={draftModel}
                    onChange={(e) => setDraftModel(e.target.value)}
                    placeholder="gpt-4o-mini"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className={label}>System prompt</label>
                  <textarea
                    className={`${input} min-h-[100px] font-mono text-xs`}
                    value={draftPrompt}
                    onChange={(e) => setDraftPrompt(e.target.value)}
                    placeholder="You are…"
                  />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {editingId ? (
                  <>
                    <button
                      type="button"
                      onClick={applyEdit}
                      className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-900/25 hover:brightness-110"
                    >
                      Save changes
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setShowComposer(false);
                      }}
                      className="rounded-xl border border-white/15 px-5 py-2 text-sm text-zinc-300 hover:bg-white/[0.04]"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={addNew}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-900/25 hover:brightness-110"
                    >
                      <Plus className="h-4 w-4" />
                      Add to library
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowComposer(false)}
                      className="rounded-xl border border-white/15 px-5 py-2 text-sm text-zinc-300 hover:bg-white/[0.04]"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {/* Grid */}
          <div className="max-h-[min(520px,56vh)] overflow-y-auto px-6 py-5">
            {filteredAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-[#0c0c12] px-6 py-16 text-center">
                <Bot className="h-12 w-12 text-zinc-600" aria-hidden />
                <p className="mt-4 text-lg font-medium text-zinc-300">
                  {libraryDocument.agents.length === 0
                    ? "Your library is empty"
                    : "No search results"}
                </p>
                <p className="mt-2 max-w-sm text-sm text-zinc-500">
                  {libraryDocument.agents.length === 0
                    ? "Create a reusable persona — it will appear on multi-agent nodes with a Library badge when linked."
                    : "Try a different search term."}
                </p>
                {libraryDocument.agents.length === 0 ? (
                  <button
                    type="button"
                    onClick={startCreate}
                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    Create new agent
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredAgents.map((a) => {
                  const usedIn = countWorkflowsUsingAgent(a.id, workflowsForUsage);
                  return (
                    <article
                      key={a.id}
                      className="group flex h-full flex-col rounded-2xl border border-white/[0.1] bg-gradient-to-b from-[#17171f] to-[#101014] p-[18px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-violet-400/40 hover:shadow-[0_16px_48px_-14px_rgba(139,92,246,0.45)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-[16px] font-bold leading-snug text-white">
                            {a.name}
                          </h3>
                          <span className="mt-2 inline-flex rounded-lg bg-sky-500/15 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-sky-200/95 ring-1 ring-sky-400/25">
                            {a.model ?? "gpt-4o-mini"}
                          </span>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            title="Edit"
                            className="rounded-lg border border-white/14 bg-white/[0.04] p-2 text-zinc-400 transition hover:bg-violet-500/20 hover:text-zinc-50"
                            onClick={() => startEdit(a)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            className="rounded-lg border border-white/14 bg-white/[0.04] p-2 text-zinc-500 transition hover:border-rose-500/40 hover:bg-rose-950/60 hover:text-rose-300"
                            onClick={() => {
                              if (
                                typeof window !== "undefined" &&
                                !window.confirm(
                                  `Delete “${a.name}” from the library? Nodes that reference it may need to be updated.`,
                                )
                              ) {
                                return;
                              }
                              deleteEntry(a.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </div>
                      <p className="mt-3 flex-1 whitespace-pre-line line-clamp-2 text-[13px] leading-relaxed text-zinc-500">
                        {promptFirstTwoLines(a.systemPrompt)}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3">
                        <span className="inline-flex items-center rounded-full bg-zinc-800/90 px-3 py-1 text-[11px] font-semibold text-zinc-300 ring-1 ring-white/[0.08]">
                          Used in {usedIn} workflow{usedIn === 1 ? "" : "s"}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-600">
                          {a.id.slice(0, 8)}…
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.06] bg-[#08080c] px-6 py-4">
            <Dialog.Close asChild>
              <button
                type="button"
                className="w-full rounded-xl border border-white/12 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.04]"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
