import type { ReactElement } from "react";

export interface WorkflowInspectorPanelProps {
  workflowId: string;
  onWorkflowIdChange: (id: string) => void;
  workflowDescription: string;
  onWorkflowDescriptionChange: (v: string) => void;
  initialDataRaw: string;
  onInitialDataRawChange: (v: string) => void;
}

export function WorkflowInspectorPanel(
  props: WorkflowInspectorPanelProps,
): ReactElement {
  const inputClass =
    "w-full rounded-xl border border-white/[0.08] bg-[#1a1a22] px-3 py-2 text-sm text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none ring-violet-400/15 focus:border-violet-400/45 focus:ring-2";
  const labelClass =
    "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500";

  return (
    <div className="space-y-5">
      <div>
        <label className={labelClass} htmlFor="inspector-wf-id">
          Workflow ID
        </label>
        <input
          id="inspector-wf-id"
          type="text"
          value={props.workflowId}
          onChange={(e) => props.onWorkflowIdChange(e.target.value)}
          className={`${inputClass} font-mono text-[13px]`}
          spellCheck={false}
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
          Used as <code className="text-violet-400">definition.id</code> when
          you export or run.
        </p>
      </div>
      <div>
        <label className={labelClass} htmlFor="inspector-wf-desc">
          Description
        </label>
        <textarea
          id="inspector-wf-desc"
          value={props.workflowDescription}
          onChange={(e) => props.onWorkflowDescriptionChange(e.target.value)}
          rows={3}
          placeholder="Notes for your team (local only for now)"
          className={`${inputClass} resize-y placeholder:text-zinc-500`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="inspector-initial-json">
          Initial data (JSON)
        </label>
        <textarea
          id="inspector-initial-json"
          value={props.initialDataRaw}
          onChange={(e) => props.onInitialDataRawChange(e.target.value)}
          rows={8}
          spellCheck={false}
          className={`${inputClass} min-h-[140px] resize-y font-mono text-xs leading-relaxed text-zinc-300`}
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
          Merged into entry nodes when you run (e.g. webhook payload).
        </p>
      </div>
    </div>
  );
}
