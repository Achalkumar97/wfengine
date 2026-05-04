import {
  AgentPersonaSchema,
  AutogenAgentConfigPartialSchema,
  AutogenAgentConfigSchema,
} from "@wfengine/nodes-agents/schemas";
import type { WfNodeData } from "@wfengine/ui";
import * as Dialog from "@radix-ui/react-dialog";
import { type ReactElement, useEffect, useState } from "react";
import type { Node } from "reactflow";
import { toast } from "sonner";

const label =
  "mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500";
const input =
  "w-full rounded-xl border border-white/[0.08] bg-[#1a1a22] px-2.5 py-1.5 text-sm text-zinc-200 outline-none ring-violet-400/15 focus:border-violet-400/45 focus:ring-2";

export function AgentPersonaEditDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { nodeId: string; index: number } | null;
  getNodes: () => Node<WfNodeData>[];
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
}): ReactElement {
  const { open, onOpenChange, target, getNodes, updateNodeConfig } = props;

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [libraryAgentId, setLibraryAgentId] = useState<string | undefined>();
  const [detachLibrary, setDetachLibrary] = useState(false);
  const [mode, setMode] = useState<"team" | "single">("team");

  useEffect(() => {
    if (!open || !target) return;
    const node = getNodes().find((n) => n.id === target.nodeId);
    if (!node) return;
    const wfType = node.data.wfType;
    const cfg = (node.data.config ?? {}) as Record<string, unknown>;

    if (wfType === "autogen.agent") {
      setMode("single");
      const p = AutogenAgentConfigPartialSchema.safeParse(cfg);
      setName(
        p.success && p.data.agentName?.trim()
          ? p.data.agentName
          : "agent",
      );
      setSystemPrompt(
        typeof cfg.systemPrompt === "string" ? cfg.systemPrompt : "",
      );
      setModel(
        typeof cfg.model === "string" && cfg.model.trim()
          ? cfg.model
          : "gpt-4o-mini",
      );
      setLibraryAgentId(
        typeof cfg.libraryAgentId === "string"
          ? cfg.libraryAgentId
          : undefined,
      );
      setDetachLibrary(false);
      setRole("");
      return;
    }

    setMode("team");
    const agents = cfg.agents;
    if (!Array.isArray(agents) || !agents[target.index]) return;
    const raw = agents[target.index] as Record<string, unknown>;
    setName(typeof raw.name === "string" ? raw.name : "");
    setRole(typeof raw.role === "string" ? raw.role : "");
    setSystemPrompt(
      typeof raw.systemPrompt === "string" ? raw.systemPrompt : "",
    );
    setLibraryAgentId(
      typeof raw.libraryAgentId === "string"
        ? raw.libraryAgentId
        : undefined,
    );
    setDetachLibrary(false);
    setModel(
      typeof cfg.model === "string" && String(cfg.model).trim()
        ? String(cfg.model)
        : "gpt-4o-mini",
    );
  }, [open, target, getNodes]);

  const handleSave = (): void => {
    if (!target) return;
    const node = getNodes().find((n) => n.id === target.nodeId);
    if (!node) return;
    const wfType = node.data.wfType;
    const cfg = { ...(node.data.config ?? {}) } as Record<string, unknown>;

    if (wfType === "autogen.agent") {
      const merged: Record<string, unknown> = {
        ...cfg,
        agentName: name.trim() || "agent",
        systemPrompt: systemPrompt.trim(),
        model: model.trim() || "gpt-4o-mini",
      };
      if (detachLibrary) {
        delete merged.libraryAgentId;
      } else if (libraryAgentId) {
        merged.libraryAgentId = libraryAgentId;
      }
      const parsed = AutogenAgentConfigSchema.safeParse(merged);
      if (!parsed.success) {
        toast.error(parsed.error.message);
        return;
      }
      updateNodeConfig(target.nodeId, parsed.data as Record<string, unknown>);
      toast.success("Agent updated");
      onOpenChange(false);
      return;
    }

    const agents = cfg.agents;
    if (!Array.isArray(agents)) return;
    const nextAgents = [...agents];
    const personaIn: Record<string, unknown> = {
      name: name.trim() || "agent",
      systemPrompt: systemPrompt.trim(),
    };
    if (role.trim()) personaIn.role = role.trim();
    if (!detachLibrary && libraryAgentId) {
      personaIn.libraryAgentId = libraryAgentId;
    }

    const parsed = AgentPersonaSchema.safeParse(personaIn);
    if (!parsed.success) {
      toast.error(parsed.error.message);
      return;
    }

    nextAgents[target.index] = parsed.data as unknown as object;
    updateNodeConfig(target.nodeId, {
      ...cfg,
      agents: nextAgents,
    });
    toast.success("Agent updated");
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] max-h-[88vh] w-[min(480px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-white/[0.1] bg-[#13131a] p-5 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out">
          <Dialog.Title className="text-lg font-semibold text-zinc-100">
            {mode === "single" ? "Edit agent" : "Edit persona"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-zinc-400">
            Changes apply to this node immediately on save.
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <div>
              <label className={label}>
                {mode === "single" ? "Agent name" : "Name"}
              </label>
              <input
                className={input}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {mode === "team" ? (
              <div>
                <label className={label}>Role (optional)</label>
                <input
                  className={input}
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="Short label for transcripts"
                />
              </div>
            ) : null}
            <div>
              <label className={label}>System prompt</label>
              <textarea
                className={`${input} min-h-[120px] resize-y font-mono text-xs`}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label className={label}>Model</label>
              <input
                className={input}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            {libraryAgentId ? (
              <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={detachLibrary}
                  onChange={(e) => setDetachLibrary(e.target.checked)}
                  className="mt-1 rounded border-zinc-600"
                />
                <span>
                  Detach from Agent Library (keep prompt inline only)
                </span>
              </label>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-white/[0.06] pt-4">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:bg-white/[0.04]"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
