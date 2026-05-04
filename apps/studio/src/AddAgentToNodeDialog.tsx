import { AgentPersonaSchema } from "@wfengine/nodes-agents/schemas";
import type { InspectorAgentLibraryEntry, WfNodeData } from "@wfengine/ui";
import * as Dialog from "@radix-ui/react-dialog";
import { BookMarked, Bot, Plus, Search, Sparkles, UserPlus } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import type { Node } from "reactflow";
import { toast } from "sonner";
import { z } from "zod";
import {
  appendBlankPersona,
  appendPersonaFromLibrary,
} from "./agent-inspector-ui.js";

const label =
  "mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500";
const input =
  "w-full rounded-xl border border-white/[0.08] bg-[#1a1a22] px-2.5 py-1.5 text-sm text-zinc-200 outline-none ring-violet-400/15 focus:border-violet-400/45 focus:ring-2";

const MODEL_OPTIONS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { id: "o1-mini", label: "o1-mini" },
  { id: "custom", label: "Custom…" },
] as const;

function previewSnippet(text: string | undefined, maxChars: number): string {
  if (!text?.trim()) return "— No prompt stored; resolved at run if from library.";
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 1)}…`;
}

type TabId = "library" | "create";

export function AddAgentToNodeDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetNodeId: string | null;
  getNodes: () => Node<WfNodeData>[];
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  libraryEntries: readonly InspectorAgentLibraryEntry[];
  onManageAgentLibrary?: () => void;
}): ReactElement {
  const {
    open,
    onOpenChange,
    targetNodeId,
    getNodes,
    updateNodeConfig,
    libraryEntries,
    onManageAgentLibrary,
  } = props;

  const [tab, setTab] = useState<TabId>("library");
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("agent");
  const [newPrompt, setNewPrompt] = useState(
    "Describe this agent's role and behavior in one or two sentences.",
  );
  const [modelSelect, setModelSelect] = useState<string>("gpt-4o-mini");
  const [customModel, setCustomModel] = useState("");

  useEffect(() => {
    if (!open) {
      setTab("library");
      setSearch("");
      setNewName("agent");
      setNewPrompt(
        "Describe this agent's role and behavior in one or two sentences.",
      );
      setModelSelect("gpt-4o-mini");
      setCustomModel("");
    }
  }, [open]);

  const resolvedTeamModel = useMemo(() => {
    if (modelSelect === "custom") return customModel.trim() || "gpt-4o-mini";
    return modelSelect;
  }, [modelSelect, customModel]);

  const filteredLibrary = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [...libraryEntries];
    return libraryEntries.filter((e) => {
      const blob = `${e.name} ${e.id} ${e.model ?? ""} ${e.systemPrompt ?? ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [libraryEntries, search]);

  const applyAgentsJson = (agentsJson: string): boolean => {
    if (!targetNodeId) return false;
    const node = getNodes().find((n) => n.id === targetNodeId);
    if (!node) {
      toast.error("Node not found");
      return false;
    }
    const wfType = node.data.wfType;
    if (wfType !== "mfa.agent-group" && wfType !== "autogen.multi-agent") {
      toast.error("This node does not support a team of agents");
      return false;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(agentsJson);
    } catch {
      toast.error("Invalid agent list");
      return false;
    }
    const check = z.array(AgentPersonaSchema).safeParse(parsed);
    if (!check.success) {
      toast.error(check.error.message);
      return false;
    }
    const cfg = { ...(node.data.config ?? {}) } as Record<string, unknown>;
    updateNodeConfig(targetNodeId, {
      ...cfg,
      agents: check.data as unknown as object[],
    });
    return true;
  };

  const addFromLibrary = (entry: InspectorAgentLibraryEntry): void => {
    if (!targetNodeId) return;
    const node = getNodes().find((n) => n.id === targetNodeId);
    if (!node) return;
    const cfg = { ...(node.data.config ?? {}) } as Record<string, unknown>;
    const agentsJson = JSON.stringify(
      Array.isArray(cfg.agents) ? cfg.agents : [],
    );
    const next = appendPersonaFromLibrary(agentsJson, entry);
    if (applyAgentsJson(next)) {
      toast.success(`Added “${entry.name}” from library`);
      onOpenChange(false);
    }
  };

  const addInlineNew = (): void => {
    if (!targetNodeId) return;
    const node = getNodes().find((n) => n.id === targetNodeId);
    if (!node) return;
    const cfg = { ...(node.data.config ?? {}) } as Record<string, unknown>;
    const agentsJson = JSON.stringify(
      Array.isArray(cfg.agents) ? cfg.agents : [],
    );
    const withBlank = appendBlankPersona(agentsJson);
    let list: unknown[];
    try {
      list = JSON.parse(withBlank) as unknown[];
    } catch {
      toast.error("Could not build agent list");
      return;
    }
    const last = list[list.length - 1];
    if (!last || typeof last !== "object" || Array.isArray(last)) {
      toast.error("Invalid agent list");
      return;
    }
    const merged = {
      ...(last as Record<string, unknown>),
      name: newName.trim() || "agent",
      systemPrompt: newPrompt.trim(),
    };
    list[list.length - 1] = merged;
    const check = z.array(AgentPersonaSchema).safeParse(list);
    if (!check.success) {
      toast.error(check.error.message);
      return;
    }
    const wfType = node.data.wfType;
    if (wfType !== "mfa.agent-group" && wfType !== "autogen.multi-agent") {
      return;
    }
    updateNodeConfig(targetNodeId, {
      ...cfg,
      agents: check.data as unknown as object[],
      model: resolvedTeamModel,
    });
    toast.success("Agent added to node");
    onOpenChange(false);
  };

  const titleId = "add-agent-to-node-title";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-labelledby={titleId}
          className="fixed left-1/2 top-1/2 z-[71] flex max-h-[min(720px,90vh)] w-[min(800px,96vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0e0e14] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.65)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="shrink-0 border-b border-white/[0.06] bg-gradient-to-br from-violet-950/60 via-[#14141c] to-[#0e0e14] px-6 py-5">
            <Dialog.Title
              id={titleId}
              className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-zinc-50"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20 ring-1 ring-violet-400/30">
                <Sparkles className="h-5 w-5 text-violet-300" aria-hidden />
              </span>
              Add agent to this node
            </Dialog.Title>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Pull in a saved library persona or define a new inline teammate. The
              node stays selected so you can tune orchestration in the inspector.
            </p>
            <div className="mt-5 flex gap-1 rounded-xl bg-black/35 p-1 ring-1 ring-white/[0.07]">
              <button
                type="button"
                onClick={() => setTab("library")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition ${
                  tab === "library"
                    ? "bg-violet-600 text-white shadow-lg shadow-violet-950/50"
                    : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
                }`}
              >
                <BookMarked className="h-4 w-4" aria-hidden />
                From library
              </button>
              <button
                type="button"
                onClick={() => setTab("create")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition ${
                  tab === "create"
                    ? "bg-violet-600 text-white shadow-lg shadow-violet-950/50"
                    : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
                }`}
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                Create new
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {tab === "library" ? (
              <div className="space-y-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="search"
                    placeholder="Search by name, model, or prompt…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className={`${input} pl-10`}
                    autoComplete="off"
                  />
                </div>
                {libraryEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/[0.1] bg-[#0a0a10] px-6 py-14 text-center">
                    <Bot className="mx-auto h-10 w-10 text-zinc-600" aria-hidden />
                    <p className="mt-3 text-sm font-medium text-zinc-300">
                      Your library is empty
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Create reusable personas in Agent Library, then add them here.
                    </p>
                    {onManageAgentLibrary ? (
                      <button
                        type="button"
                        onClick={() => {
                          onManageAgentLibrary();
                          onOpenChange(false);
                        }}
                        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
                      >
                        Open Agent Library
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {filteredLibrary.map((e) => (
                      <article
                        key={e.id}
                        className="flex flex-col rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#18181f] to-[#12121a] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-violet-500/35"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/25">
                            <Bot className="h-5 w-5" aria-hidden />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-[15px] font-semibold text-zinc-50">
                              {e.name}
                            </h3>
                            <span className="mt-1.5 inline-flex rounded-md bg-cyan-500/15 px-2 py-0.5 font-mono text-[11px] font-medium text-cyan-200/95 ring-1 ring-cyan-400/20">
                              {e.model?.trim() || "gpt-4o-mini"}
                            </span>
                            <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-zinc-500">
                              {previewSnippet(e.systemPrompt, 180)}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => addFromLibrary(e)}
                          className="mt-4 w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/30 transition hover:brightness-110"
                        >
                          <span className="inline-flex items-center justify-center gap-2">
                            <Plus className="h-4 w-4" aria-hidden />
                            Add to node
                          </span>
                        </button>
                      </article>
                    ))}
                  </div>
                )}
                {libraryEntries.length > 0 && filteredLibrary.length === 0 ? (
                  <p className="py-8 text-center text-sm text-zinc-500">
                    No matches — try a different search.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mx-auto max-w-lg space-y-4">
                <div>
                  <label className={label}>Display name</label>
                  <input
                    className={input}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Reviewer"
                  />
                </div>
                <div>
                  <label className={label}>Team model</label>
                  <select
                    className={input}
                    value={modelSelect}
                    onChange={(e) => setModelSelect(e.target.value)}
                  >
                    {MODEL_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {modelSelect === "custom" ? (
                    <input
                      className={`${input} mt-2`}
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder="e.g. anthropic/claude-3-5-sonnet"
                    />
                  ) : null}
                </div>
                <div>
                  <label className={label}>System prompt</label>
                  <textarea
                    className={`${input} min-h-[140px] resize-y font-mono text-xs leading-relaxed`}
                    value={newPrompt}
                    onChange={(e) => setNewPrompt(e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
                  Creates an{" "}
                  <span className="font-medium text-zinc-400">INLINE</span>{" "}
                  persona on this node only. To reuse elsewhere, add it to the
                  global Agent Library later.
                </p>
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-3 border-t border-white/[0.06] bg-[#08080c] px-6 py-4">
            <p className="text-center text-[11px] leading-snug text-zinc-500">
              Added agents appear in the{" "}
              <span className="text-zinc-400">Agents</span> list inside this node
              on the canvas — edit or remove them there anytime.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:bg-white/[0.05]"
                >
                  Cancel
                </button>
              </Dialog.Close>
              {tab === "create" ? (
                <button
                  type="button"
                  onClick={() => addInlineNew()}
                  className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 hover:brightness-110"
                >
                  Add to node
                </button>
              ) : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
