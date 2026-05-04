import { AgentPersonaSchema } from "@wfengine/nodes-agents/schemas";
import type { InspectorAgentLibraryEntry } from "@wfengine/ui";
import { BookMarked, Bot, Library, Plus, Trash2 } from "lucide-react";
import { type ReactElement, type ReactNode } from "react";
import { z } from "zod";

const cardClass =
  "rounded-xl border border-white/[0.08] bg-[#16161e] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export type PersonaDisplayRow = {
  name: string;
  role?: string | undefined;
  modelLabel: string;
  promptPreview: string;
  fromLibrary: boolean;
};

function resolveModelForPersona(
  libraryAgentId: string | undefined,
  teamModel: string,
  libraryEntries: readonly InspectorAgentLibraryEntry[] | undefined,
): string {
  if (!libraryAgentId || !libraryEntries?.length) return teamModel;
  const row = libraryEntries.find((e) => e.id === libraryAgentId);
  const m = row?.model?.trim();
  return m && m.length > 0 ? m : teamModel;
}

/** Parse personas JSON for visual list + labels */
export function parsePersonasForDisplay(
  agentsJson: string,
  teamModel: string,
  libraryEntries: readonly InspectorAgentLibraryEntry[] | undefined,
): { ok: true; rows: PersonaDisplayRow[] } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(agentsJson);
  } catch {
    return { ok: false, message: "Invalid JSON — fix it below or reset." };
  }
  const parsed = z.array(AgentPersonaSchema).safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Personas do not match the expected shape yet.",
    };
  }
  const rows: PersonaDisplayRow[] = parsed.data.map((p) => {
    const modelLabel = resolveModelForPersona(
      p.libraryAgentId,
      teamModel,
      libraryEntries,
    );
    const hasPrompt =
      p.systemPrompt !== undefined && p.systemPrompt.trim().length > 0;
    const promptPreview = hasPrompt
      ? truncate(p.systemPrompt!, 140)
      : p.libraryAgentId
        ? "Prompt resolved from Agent Library at run time."
        : "(No system prompt — add one in Advanced JSON.)";
    return {
      name: p.name,
      role: p.role,
      modelLabel,
      promptPreview,
      fromLibrary: Boolean(p.libraryAgentId),
    };
  });
  return { ok: true, rows };
}

export function AgentPersonaCard(props: {
  row: PersonaDisplayRow;
  index: number;
  onRemove?: ((index: number) => void) | undefined;
  removeDisabled?: boolean;
  removeTitle?: string;
}): ReactElement {
  const { row, index, onRemove, removeDisabled, removeTitle } = props;
  return (
    <div className={cardClass}>
      <div className="flex gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 text-violet-300">
          <Bot className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-zinc-100">
              {row.name}
            </span>
            {row.fromLibrary ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300/95">
                <Library className="h-3 w-3" aria-hidden />
                Library
              </span>
            ) : null}
          </div>
          {row.role ? (
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
              <span className="text-zinc-500">Role · </span>
              {row.role}
            </p>
          ) : null}
          <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">
            Model
            <span className="ml-1.5 font-mono text-[11px] normal-case tracking-normal text-violet-300/90">
              {row.modelLabel}
            </span>
          </p>
          <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-zinc-500">
            {row.promptPreview}
          </p>
        </div>
        {onRemove ? (
          <button
            type="button"
            title={removeTitle ?? "Remove agent"}
            disabled={removeDisabled}
            onClick={() => onRemove(index)}
            className="self-start rounded-lg p-1.5 text-zinc-500 transition hover:bg-rose-500/15 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Outer shell for orchestration / runtime controls at the top of agent inspectors. */
export const orchestrationCardClass =
  "rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-950/40 to-[#16161e] px-3 py-2.5";

/** Helper text under the MAF orchestration &lt;select&gt; (no outer card). */
export function MfaOrchestrationModeHint(props: { mode: string }): ReactElement {
  const isSeq = props.mode === "sequential";
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
      {isSeq
        ? "Each persona runs once in list order. Later agents see earlier replies in the same thread."
        : "One model call returns a full transcript and final answer (faster, less like real multi-turn chat)."}
    </p>
  );
}

export function AutogenMultiOrchestrationHint(props: {
  runtime: string;
  maxTurns: number;
}): ReactElement {
  const py = props.runtime === "python_autogen";
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
      {py
        ? "Team execution is delegated to your Python module (stdin/stdout JSON)."
        : `Round-robin in Node: agents take turns (A → B → C → …) up to ${props.maxTurns} steps.`}
    </p>
  );
}

export function SingleAgentRuntimeHint(props: { runtime: string }): ReactElement {
  const py = props.runtime === "python_autogen";
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
      {py
        ? "Runs your Python module with the workflow payload on stdin."
        : "Uses OpenAI-compatible chat on the runner (optional tool loops when configured)."}
    </p>
  );
}

export function AgentsSectionHeader(props: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {props.title}
          </h3>
          {props.subtitle ? (
            <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
              {props.subtitle}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {props.children}
        </div>
      </div>
    </div>
  );
}

const btnSecondary =
  "inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#1f1f28] px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition hover:border-violet-400/35 hover:bg-[#252530]";

const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-violet-600/90 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-[0_2px_12px_rgba(139,92,246,0.25)] transition hover:bg-violet-500";

export function AddAgentToolbar(props: {
  libraryEntries: readonly InspectorAgentLibraryEntry[] | undefined;
  onPickLibraryEntry: (entry: InspectorAgentLibraryEntry) => void;
  /** Omit to hide the blank / inline-add button (e.g. single-agent node). */
  onAddBlank?: (() => void) | undefined;
  onOpenAgentLibrary?: (() => void) | undefined;
  blankLabel?: string;
}): ReactElement {
  const {
    libraryEntries,
    onPickLibraryEntry,
    onAddBlank,
    onOpenAgentLibrary,
    blankLabel,
  } = props;
  return (
    <>
      {onAddBlank ? (
        <button type="button" className={btnPrimary} onClick={onAddBlank}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {blankLabel ?? "Add agent"}
        </button>
      ) : null}
      {(libraryEntries?.length ?? 0) > 0 ? (
        <div className="relative inline-flex">
          <select
            className={`${btnSecondary} cursor-pointer appearance-none pr-7`}
            aria-label="Add agent from library"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              const entry = libraryEntries?.find((x) => x.id === id);
              e.currentTarget.value = "";
              if (entry) onPickLibraryEntry(entry);
            }}
          >
            <option value="">From library…</option>
            {libraryEntries?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <BookMarked className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        </div>
      ) : null}
      {onOpenAgentLibrary ? (
        <button
          type="button"
          className={btnSecondary}
          onClick={onOpenAgentLibrary}
        >
          <Library className="h-3.5 w-3.5 text-violet-400/90" aria-hidden />
          Agent Library
        </button>
      ) : null}
    </>
  );
}

export function appendPersonaFromLibrary(
  agentsJson: string,
  entry: InspectorAgentLibraryEntry,
): string {
  let list: unknown[];
  try {
    const raw = JSON.parse(agentsJson);
    list = Array.isArray(raw) ? [...raw] : [];
  } catch {
    list = [];
  }
  list.push({
    libraryAgentId: entry.id,
    name: entry.name,
  });
  return JSON.stringify(list, null, 2);
}

export function appendBlankPersona(agentsJson: string): string {
  let list: unknown[];
  try {
    const raw = JSON.parse(agentsJson);
    list = Array.isArray(raw) ? [...raw] : [];
  } catch {
    list = [];
  }
  const n = list.length + 1;
  list.push({
    name: `agent_${n}`,
    systemPrompt:
      "Describe this agent's role and behavior in one or two sentences.",
  });
  return JSON.stringify(list, null, 2);
}

export function removePersonaAt(agentsJson: string, index: number): string {
  let raw: unknown;
  try {
    raw = JSON.parse(agentsJson);
  } catch {
    return agentsJson;
  }
  if (!Array.isArray(raw)) return agentsJson;
  if (index < 0 || index >= raw.length) return agentsJson;
  raw.splice(index, 1);
  return JSON.stringify(raw, null, 2);
}
