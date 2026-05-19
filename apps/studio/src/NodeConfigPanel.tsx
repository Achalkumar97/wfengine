import { zodResolver } from "@hookform/resolvers/zod";
import { cn, type InspectorRenderProps } from "@wfengine/ui";
import { AgentToolsPicker } from "./AgentToolsPicker.js";
import {
  CronTriggerConfigSchema,
  EmailReadConfigSchema,
  EmailSendConfigSchema,
  FileReadConfigSchema,
  FileWriteConfigSchema,
  CodeWriteTestFilesConfigSchema,
  GitHubRepoAnalyzeConfigSchema,
  GitHubFilesReadConfigSchema,
  GitHubRepoGenerateTestsLlmConfigSchema,
  LlmGenerateUnitTestsConfigSchema,
  GitHubRepoListBranchesConfigSchema,
  GitHubRepoRunTestsConfigSchema,
  HttpRequestConfigSchema,
  PostgresQueryConfigSchema,
  SlackSendFormSchema,
} from "@wfengine/nodes-base/config-schemas";
import {
  AgentPersonaSchema,
  AutogenAgentConfigPartialSchema,
  AutogenAgentConfigSchema,
  AutogenMultiAgentConfigSchema,
  MfaAgentGroupConfigSchema,
  type AgentToolRef,
} from "@wfengine/nodes-agents/schemas";
import {
  AddAgentToolbar,
  appendBlankPersona,
  appendPersonaFromLibrary,
  AutogenMultiOrchestrationHint,
  MfaOrchestrationModeHint,
  orchestrationCardClass,
  SingleAgentRuntimeHint,
} from "./agent-inspector-ui.js";
import {
  clearOllamaModelCache,
  fetchOllamaModels,
} from "./ollama-models.js";
import { Bot, Eye, EyeOff, RefreshCw } from "lucide-react";
import {
  useCallback,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from "react";
import {
  useForm,
  useWatch,
  type FieldValues,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const fieldLabel = (c?: string) =>
  cn(
    "mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500",
    c,
  );
const fieldInput = (c?: string) =>
  cn(
    "w-full rounded-xl border border-white/[0.08] bg-[#1a1a22] px-2.5 py-1.5 text-sm text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none ring-violet-400/15 focus:border-violet-400/45 focus:ring-2",
    c,
  );
const fieldGroup = (c?: string) => cn("mb-3.5", c);

/** Remove blank LLM override fields while preserving intentional per-node provider config. */
function stripOpenAiEnvFromConfig(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...data };
  for (const key of ["openAiBaseUrl", "openAiApiKey", "ollamaBaseUrl"]) {
    if (typeof out[key] === "string" && out[key].trim().length === 0) {
      delete out[key];
    }
  }
  return out;
}

function LlmProviderSection(props: {
  providerField: UseFormRegisterReturn;
  openAiBaseUrlField: UseFormRegisterReturn;
  openAiApiKeyField: UseFormRegisterReturn;
  ollamaBaseUrlField: UseFormRegisterReturn;
  provider: unknown;
}): ReactElement {
  const provider = props.provider === "ollama" ? "ollama" : "openai";
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#14141a] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/85">
        LLM provider
      </p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div className={fieldGroup("mb-0")}>
          <label className={fieldLabel()}>Provider</label>
          <select {...props.providerField} className={fieldInput()}>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama</option>
          </select>
        </div>
        <div className={fieldGroup("mb-0")}>
          <label className={fieldLabel()}>
            {provider === "ollama" ? "Ollama base URL" : "OpenAI base URL"}
          </label>
          <input
            {...(provider === "ollama"
              ? props.ollamaBaseUrlField
              : props.openAiBaseUrlField)}
            className={fieldInput()}
            placeholder={
              provider === "ollama"
                ? "http://127.0.0.1:11434/v1"
                : "https://api.openai.com/v1"
            }
            spellCheck={false}
          />
        </div>
      </div>
      {provider === "openai" ? (
        <div className={fieldGroup("mb-0 mt-3")}>
          <label className={fieldLabel()}>OpenAI API key override</label>
          <SecretInput
            {...props.openAiApiKeyField}
            placeholder="Uses WFENGINE_OPENAI_API_KEY / OPENAI_API_KEY when empty"
          />
        </div>
      ) : (
        <p className="mt-2 text-[10px] leading-snug text-zinc-500">
          Ollama uses OpenAI-compatible <code className="text-zinc-400">/v1</code>{" "}
          chat completions. From Docker, use your host IP or{" "}
          <code className="text-zinc-400">host.docker.internal</code> instead of localhost.
        </p>
      )}
    </div>
  );
}

function OllamaAwareModelField(props: {
  modelField: UseFormRegisterReturn;
  setModel: (value: string) => void;
  provider: unknown;
  ollamaBaseUrl: unknown;
  model: unknown;
  label?: string;
}): ReactElement {
  const provider = props.provider === "ollama" ? "ollama" : "openai";
  const baseUrl =
    typeof props.ollamaBaseUrl === "string" ? props.ollamaBaseUrl : "";
  const currentModel = typeof props.model === "string" ? props.model : "";
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(
    async (force = false) => {
      if (provider !== "ollama") return;
      if (force) clearOllamaModelCache(baseUrl);
      setLoading(true);
      setError(null);
      try {
        const next = await fetchOllamaModels(baseUrl);
        setModels(next);
      } catch (err) {
        setModels([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, provider],
  );

  useEffect(() => {
    if (provider !== "ollama") {
      setModels([]);
      setError(null);
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void loadModels(false);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [loadModels, provider]);

  if (provider !== "ollama") {
    return (
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>{props.label ?? "Model"}</label>
        <input {...props.modelField} className={fieldInput()} />
      </div>
    );
  }

  const options = currentModel && !models.includes(currentModel)
    ? [currentModel, ...models]
    : models;
  const canUseDropdown = options.length > 0 && !error;

  return (
    <div className={fieldGroup()}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className={fieldLabel("mb-0")}>{props.label ?? "Model"}</label>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#1a1a22] px-2 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-violet-400/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void loadModels(true)}
          disabled={loading}
          title="Refresh Ollama models"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", loading && "animate-spin")}
            aria-hidden
          />
          Refresh Models
        </button>
      </div>

      {canUseDropdown ? (
        <select
          {...props.modelField}
          className={fieldInput()}
          value={currentModel}
          onChange={(event) => props.setModel(event.target.value)}
        >
          {options.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...props.modelField}
          className={fieldInput()}
          placeholder="qwen2.5:14b"
          spellCheck={false}
        />
      )}

      {loading ? (
        <p className="mt-1.5 text-[10px] text-zinc-500">
          Loading models from Ollama...
        </p>
      ) : error ? (
        <p className="mt-1.5 text-[10px] leading-snug text-amber-300/90">
          {error} You can still type the model name manually.
        </p>
      ) : models.length > 0 ? (
        <p className="mt-1.5 text-[10px] text-zinc-500">
          Found {models.length} model{models.length === 1 ? "" : "s"}.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Password / token field with show-hide toggle.
 * Must be forwardRef so react-hook-form's register() ref reaches the real input.
 */
const SecretInput = forwardRef<
  HTMLInputElement,
  Omit<ComponentProps<"input">, "type">
>(function SecretInput(
  { className, autoComplete, ...rest },
  ref,
): ReactElement {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete ?? "off"}
        spellCheck={false}
        {...rest}
        className={cn(fieldInput(), "pr-10", className)}
      />
      <button
        type="button"
        tabIndex={-1}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200"
        onMouseDown={(e) => {
          e.preventDefault();
          setVisible((v) => !v);
        }}
        aria-label={visible ? "Hide secret" : "Show secret"}
        title={visible ? "Hide" : "Show"}
      >
        {visible ? (
          <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
        )}
      </button>
    </div>
  );
});

SecretInput.displayName = "SecretInput";

/**
 * Debounced push of form values into the canvas node's config.
 * - Full schema success → replace config (complete valid object).
 * - Otherwise, if schema is a Zod object → merge partial fields into current
 *   node config so token/channel/text etc. aren't lost before Run (fixes race
 *   where strict validation required all fields before any write).
 */
function useDebouncedValidConfig<T extends FieldValues>(
  watchValues: Partial<T>,
  schema: z.ZodType<Record<string, unknown>>,
  nodeId: string,
  updateNodeConfig: (id: string, config: Record<string, unknown>) => void,
  mergeBase: Record<string, unknown>,
  debounceMs = 200,
  options?: { stripOpenAiEnv?: boolean },
): void {
  // Keep mutable references so cleanup functions can always read the latest
  // values without capturing stale closures.
  const mergeRef = useRef(mergeBase);
  mergeRef.current = mergeBase;

  const watchRef = useRef(watchValues);
  watchRef.current = watchValues;

  const nodeIdRef = useRef(nodeId);
  nodeIdRef.current = nodeId;

  const updateRef = useRef(updateNodeConfig);
  updateRef.current = updateNodeConfig;

  const stripRef = useRef(options?.stripOpenAiEnv);
  stripRef.current = options?.stripOpenAiEnv;

  // Core save logic — reads from refs so it is safe to call from any cleanup.
  const saveNow = useCallback(() => {
    const vals = watchRef.current;
    const base = mergeRef.current;
    const nid = nodeIdRef.current;
    const update = updateRef.current;
    const strip = stripRef.current;
    const baseStripped = strip
      ? stripOpenAiEnvFromConfig({ ...base })
      : { ...base };
    const merged: Record<string, unknown> = { ...baseStripped };
    
    // We want to persist EXACTLY what the user typed into the graph node,
    // even if it's currently invalid (like an empty string for a required field).
    // If we only save on success, their WIP form drops on unmount.
    
    // 1. Blindly apply all current form values
    for (const [key, val] of Object.entries(vals)) {
      if (val !== undefined) merged[key] = val;
    }

    // 2. Coerce types where possible so that numbers/booleans are stored correctly
    if (schema instanceof z.ZodObject) {
      for (const [key, fieldSchema] of Object.entries(schema.shape)) {
        if (vals[key] !== undefined) {
          const parsed = (fieldSchema as z.ZodTypeAny).safeParse(vals[key]);
          if (parsed.success) {
            merged[key] = parsed.data;
          }
        }
      }
    }

    update(nid, strip ? stripOpenAiEnvFromConfig(merged) : merged);
  }, [schema]); // schema is a module-level constant — always stable

  // Debounced save triggered by every value change.
  useEffect(() => {
    const t = window.setTimeout(saveNow, debounceMs);
    return () => window.clearTimeout(t);
  }, [watchValues, saveNow, debounceMs]);

  // ── CRITICAL FIX ─────────────────────────────────────────────────────────
  // When the user switches tabs the Node panel unmounts. The debounce cleanup
  // above cancels the pending timer BEFORE it writes to React state, so on
  // return the form reinitialises from the old (pre-typing) config.
  // This effect’s cleanup flushes the latest values immediately on unmount.
  useEffect(() => {
    return saveNow; // cleanup = flush right now
  }, [saveNow]);
}


function JsonFallback(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const raw = JSON.stringify(selectedNode.data.config ?? {}, null, 2);

  return (
    <div className="mt-2">
      <label htmlFor="wf-json-config" className={fieldLabel()}>
        JSON config
      </label>
      <textarea
        id="wf-json-config"
        aria-label="Node configuration JSON"
        defaultValue={raw}
        key={selectedNode.id}
        onBlur={(e) => {
          try {
            const parsed = JSON.parse(e.target.value) as Record<
              string,
              unknown
            >;
            updateNodeConfig(selectedNode.id, parsed);
          } catch {
            /* invalid */
          }
        }}
        rows={14}
        className={fieldInput("min-h-[160px] font-mono text-xs")}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
        No structured form for this node type yet — edit JSON directly.
      </p>
    </div>
  );
}

function EmptyNote(props: { title: string }): ReactElement {
  return (
    <p className="mt-2 text-sm leading-relaxed text-zinc-500">{props.title}</p>
  );
}

function CronPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;

  const cfg = selectedNode.data.config ?? {};
  const defaults = useMemo(
    () =>
      CronTriggerConfigSchema.partial().parse(selectedNode.data.config ?? {}),
    [selectedNode.id, selectedNode.data.config],
  );

  const form = useForm({
    resolver: zodResolver(CronTriggerConfigSchema),
    defaultValues: {
      expression: defaults.expression ?? "0 * * * *",
      timezone: defaults.timezone ?? "",
    },
  });

  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    CronTriggerConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
  );

  useEffect(() => {
    form.reset({
      expression: defaults.expression ?? "0 * * * *",
      timezone: defaults.timezone ?? "",
    });
  }, [selectedNode.id, defaults.expression, defaults.timezone, form]);

  return (
    <div className="mt-2 space-y-3">
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Cron expression</label>
        <input {...form.register("expression")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Timezone (optional)</label>
        <input {...form.register("timezone")} className={fieldInput()} />
      </div>
    </div>
  );
}

function buildHttpFromForm(values: {
  url: string;
  method: string;
  headersJson?: string | undefined;
  bodyJson?: string | undefined;
  timeoutMs: number;
  maxBodyBytes: number;
}): Record<string, unknown> {
  let headers: Record<string, string> | undefined;
  const hj = values.headersJson?.trim();
  if (hj) {
    try {
      headers = JSON.parse(hj) as Record<string, string>;
    } catch {
      headers = undefined;
    }
  }
  let body: unknown = undefined;
  const bj = values.bodyJson?.trim();
  if (bj) {
    try {
      body = JSON.parse(bj) as unknown;
    } catch {
      body = bj;
    }
  }
  return {
    url: values.url,
    method: values.method || "GET",
    headers,
    body,
    timeoutMs: Number(values.timeoutMs) || 30_000,
    maxBodyBytes: Number(values.maxBodyBytes) || 5_000_000,
  };
}

const HttpFormSchema = z.object({
  url: z.string().url(),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
    .optional()
    .default("GET"),
  headersJson: z.string().optional(),
  bodyJson: z.string().optional(),
  timeoutMs: z.coerce.number().positive().optional().default(30_000),
  maxBodyBytes: z.coerce.number().positive().optional().default(5_000_000),
});

const PostgresFormFieldsSchema = z.object({
  connectionString: z.string().min(1),
  query: z.string().min(1),
  paramsJson: z.string().optional(),
});

function HttpPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;

  const cfg = selectedNode.data.config ?? {};
  const defaults = useMemo(() => {
    const h =
      cfg.headers && typeof cfg.headers === "object"
        ? JSON.stringify(cfg.headers, null, 2)
        : "";
    let bodyStr = "";
    if (cfg.body !== undefined) {
      bodyStr =
        typeof cfg.body === "string"
          ? cfg.body
          : JSON.stringify(cfg.body, null, 2);
    }
    return {
      url: typeof cfg.url === "string" ? cfg.url : "https://httpbin.org/get",
      method:
        (cfg.method as string) ||
        ("GET" as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"),
      headersJson: h,
      bodyJson: bodyStr,
      timeoutMs: typeof cfg.timeoutMs === "number" ? cfg.timeoutMs : 30_000,
      maxBodyBytes:
        typeof cfg.maxBodyBytes === "number" ? cfg.maxBodyBytes : 5_000_000,
    };
  }, [selectedNode.id, cfg]);

  const form = useForm({
    resolver: zodResolver(HttpFormSchema),
    defaultValues: defaults,
  });

  const vals = useWatch({ control: form.control });

  useEffect(() => {
    form.reset(defaults);
  }, [selectedNode.id, form, defaults]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const parsed = HttpFormSchema.safeParse(vals);
      if (!parsed.success) return;
      const built = buildHttpFromForm(parsed.data);
      const ok = HttpRequestConfigSchema.safeParse(built);
      if (ok.success) {
        updateNodeConfig(selectedNode.id, ok.data as Record<string, unknown>);
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [vals, selectedNode.id, updateNodeConfig]);

  return (
    <div className="mt-2 space-y-3">
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>URL</label>
        <input {...form.register("url")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Method</label>
        <select {...form.register("method")} className={fieldInput()}>
          {(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const).map(
            (m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ),
          )}
        </select>
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Headers (JSON object)</label>
        <textarea
          {...form.register("headersJson")}
          rows={4}
          className={fieldInput("min-h-[72px] font-mono text-xs")}
        />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Body (JSON or raw text)</label>
        <textarea
          {...form.register("bodyJson")}
          rows={4}
          className={fieldInput("min-h-[72px] font-mono text-xs")}
        />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Timeout (ms)</label>
        <input
          type="number"
          {...form.register("timeoutMs")}
          className={fieldInput()}
        />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Max body bytes</label>
        <input
          type="number"
          {...form.register("maxBodyBytes")}
          className={fieldInput()}
        />
      </div>
    </div>
  );
}

function EmailSendPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;

  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(EmailSendConfigSchema),
    defaultValues: EmailSendConfigSchema.partial().parse(cfg),
  });

  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    EmailSendConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
  );

  useEffect(() => {
    form.reset(EmailSendConfigSchema.partial().parse(cfg));
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      {(
        [
          ["host", "SMTP host"],
          ["port", "Port"],
          ["authUser", "Username"],
          ["authPass", "Password"],
          ["from", "From"],
          ["to", "To (string or use JSON array in raw)"],
          ["subject", "Subject"],
          ["text", "Text body"],
          ["html", "HTML body"],
          ["replyTo", "Reply-To"],
          [
            "attachInputContentAsFilename",
            "Attach merged `content` as file (filename)",
          ],
        ] as const
      ).map(([key, lab]) => (
        <div key={key} className={fieldGroup()}>
          <label className={fieldLabel()}>{lab}</label>
          {key === "text" || key === "html" ? (
            <textarea
              {...form.register(key)}
              rows={3}
              className={fieldInput("min-h-[72px] font-mono text-xs")}
            />
          ) : key === "port" ? (
            <input
              type="number"
              {...form.register("port")}
              className={fieldInput()}
            />
          ) : key === "authPass" ? (
            <SecretInput {...form.register(key)} />
          ) : (
            <input {...form.register(key)} className={fieldInput()} />
          )}
        </div>
      ))}
      <div className={fieldGroup()}>
        <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
          <input type="checkbox" {...form.register("secure")} /> Secure (TLS)
        </label>
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
          <input
            type="checkbox"
            checked={form.watch("wfengineToolOnly") === true}
            onChange={(e) => {
              form.setValue("wfengineToolOnly", e.target.checked, {
                shouldDirty: true,
                shouldTouch: true,
              });
            }}
          />{" "}
          Agent invokes only — not a normal DAG step (see{" "}
          <code className="text-[10px]">workflow_node</code>)
        </label>
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
          Same graph as always: the LLM calls these nodes as tools. This flag only means “do not run this node as a regular scheduled step” so it is not executed twice. If no agent calls it, the run fails with a clear error. Uncheck for pure linear flows (every node runs in order).
        </p>
      </div>
    </div>
  );
}

function PostgresPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;

  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(PostgresFormFieldsSchema),
    defaultValues: {
      connectionString:
        typeof cfg.connectionString === "string" ? cfg.connectionString : "",
      query: typeof cfg.query === "string" ? cfg.query : "SELECT 1",
      paramsJson: Array.isArray(cfg.params)
        ? JSON.stringify(cfg.params)
        : cfg.params
          ? JSON.stringify(cfg.params)
          : "",
    },
  });

  const vals = useWatch({ control: form.control });

  useEffect(() => {
    const t = window.setTimeout(() => {
      const parsed = PostgresFormFieldsSchema.safeParse(vals);
      if (!parsed.success) return;
      let params: unknown = undefined;
      const pj = parsed.data.paramsJson?.trim();
      if (pj) {
        try {
          params = JSON.parse(pj) as unknown;
        } catch {
          return;
        }
      }
      const merged = PostgresQueryConfigSchema.safeParse({
        connectionString: parsed.data.connectionString,
        query: parsed.data.query,
        params: params as never,
      });
      if (merged.success) {
        updateNodeConfig(
          selectedNode.id,
          merged.data as Record<string, unknown>,
        );
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [vals, selectedNode.id, updateNodeConfig]);

  useEffect(() => {
    form.reset({
      connectionString:
        typeof cfg.connectionString === "string" ? cfg.connectionString : "",
      query: typeof cfg.query === "string" ? cfg.query : "SELECT 1",
      paramsJson: Array.isArray(cfg.params)
        ? JSON.stringify(cfg.params)
        : "",
    });
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Connection string</label>
        <input {...form.register("connectionString")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>SQL</label>
        <textarea
          {...form.register("query")}
          rows={5}
          className={fieldInput("min-h-[72px] font-mono text-xs")}
        />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Params (JSON array, optional)</label>
        <textarea
          {...form.register("paramsJson")}
          rows={3}
          className={fieldInput("min-h-[72px] font-mono text-xs")}
        />
      </div>
    </div>
  );
}

function SlackPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(SlackSendFormSchema),
    defaultValues: SlackSendFormSchema.partial().parse(cfg),
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    SlackSendFormSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
  );

  return (
    <div className="mt-2 space-y-3">
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Bot token</label>
        <SecretInput {...form.register("token")} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Channel</label>
        <input {...form.register("channel")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Message</label>
        <textarea
          {...form.register("text")}
          rows={4}
          className={fieldInput("min-h-[72px] font-mono text-xs")}
        />
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
          Leave empty to post the full merged upstream payload as JSON. Otherwise set
          a template; use{" "}
          <code className="text-zinc-400">{"{{totalTests}}"}</code>,{" "}
          <code className="text-zinc-400">{"{{passed}}"}</code>, etc. when
          &quot;Interpolate from input&quot; is on.
        </p>
      </div>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("interpolateFromInput")} />{" "}
        Interpolate {"{{placeholders}}"} from upstream node output
      </label>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Thread ts (optional)</label>
        <input {...form.register("threadTs")} className={fieldInput()} />
      </div>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("mrkdwn")} /> mrkdwn
      </label>
    </div>
  );
}

function EmailReadPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(EmailReadConfigSchema),
    defaultValues: EmailReadConfigSchema.partial().parse(cfg),
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    EmailReadConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
  );
  useEffect(() => {
    form.reset(EmailReadConfigSchema.partial().parse(cfg));
  }, [selectedNode.id, cfg, form]);

  const fields = [
    ["host", "IMAP host"],
    ["port", "Port"],
    ["user", "User"],
    ["password", "Password"],
    ["mailbox", "Mailbox"],
    ["maxMessages", "Max messages"],
    ["previewChars", "Preview chars"],
  ] as const;

  return (
    <div className="mt-2 space-y-3">
      {fields.map(([key, lab]) => (
        <div key={key} className={fieldGroup()}>
          <label className={fieldLabel()}>{lab}</label>
          {key === "password" ? (
            <SecretInput {...form.register(key)} />
          ) : (
            <input {...form.register(key)} className={fieldInput()} />
          )}
        </div>
      ))}
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("secure")} /> Secure
      </label>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("unseenOnly")} /> Unseen only
      </label>
    </div>
  );
}

function FileReadPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(FileReadConfigSchema),
    defaultValues: FileReadConfigSchema.partial().parse(cfg),
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    FileReadConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
  );
  useEffect(() => {
    form.reset(FileReadConfigSchema.partial().parse(cfg));
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Path</label>
        <input {...form.register("path")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Encoding</label>
        <select {...form.register("encoding")} className={fieldInput()}>
          <option value="utf8">utf8</option>
          <option value="base64">base64</option>
          <option value="binary">binary</option>
        </select>
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Max bytes</label>
        <input type="number" {...form.register("maxBytes")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Base dir</label>
        <input {...form.register("baseDir")} className={fieldInput()} />
      </div>
    </div>
  );
}

function FileWritePanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(FileWriteConfigSchema),
    defaultValues: FileWriteConfigSchema.partial().parse(cfg),
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    FileWriteConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
  );
  useEffect(() => {
    form.reset(FileWriteConfigSchema.partial().parse(cfg));
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Path</label>
        <input {...form.register("path")} className={fieldInput()} />
      </div>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("interpolatePathFromInput")} />{" "}
        Interpolate path from run data (e.g.{" "}
        <code className="text-zinc-500">{`reports/out-{{runDate}}.csv`}</code>)
      </label>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Content</label>
        <textarea
          {...form.register("content")}
          rows={6}
          className={fieldInput("min-h-[72px] font-mono text-xs")}
        />
      </div>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("interpolateContentFromInput")} />{" "}
        Interpolate content from upstream data (utf8 only)
      </label>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Encoding</label>
        <select {...form.register("encoding")} className={fieldInput()}>
          <option value="utf8">utf8</option>
          <option value="base64">base64</option>
        </select>
      </div>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("append")} /> Append
      </label>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("createDirs")} /> Create dirs
      </label>
      <div className={fieldGroup()}>
        <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
          <input
            type="checkbox"
            checked={form.watch("wfengineToolOnly") === true}
            onChange={(e) => {
              form.setValue("wfengineToolOnly", e.target.checked, {
                shouldDirty: true,
                shouldTouch: true,
              });
            }}
          />{" "}
          Agent invokes only — not a normal DAG step (see{" "}
          <code className="text-[10px]">workflow_node</code>)
        </label>
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
          Leave <strong>unchecked</strong> when every step should run in graph order. When checked, the node runs only when an agent dispatches it as a tool (avoids double execution). If it is never invoked, the run fails with an explicit error.
        </p>
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Base dir</label>
        <input {...form.register("baseDir")} className={fieldInput()} />
      </div>
    </div>
  );
}

function LlmGenerateUnitTestsPanel(
  props: InspectorRenderProps,
): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(LlmGenerateUnitTestsConfigSchema),
    defaultValues: LlmGenerateUnitTestsConfigSchema.partial().parse(cfg),
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    LlmGenerateUnitTestsConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
    200,
    { stripOpenAiEnv: true },
  );
  useEffect(() => {
    form.reset(LlmGenerateUnitTestsConfigSchema.partial().parse(cfg));
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      <p className="mb-2 text-[11px] leading-snug text-zinc-500">
        Upstream: <code className="text-zinc-400">files</code> with{" "}
        <code className="text-zinc-400">path</code>/<code className="text-zinc-400">relativePath</code>{" "}
        + <code className="text-zinc-400">content</code> (e.g.{" "}
        <span className="text-zinc-400">github.files.read</span>). Detects language
        per file; use <code className="text-zinc-400">preferredTestStyle</code> to bias
        pytest / Jest / JUnit / etc. Output includes <code className="text-zinc-400">framework</code> per
        file. LLM access uses <code className="text-zinc-400">OPENAI_API_KEY</code> /{" "}
        <code className="text-zinc-400">WFENGINE_OPENAI_BASE_URL</code> on the <strong>runner</strong> (not
        stored in this workflow). Repo identity for the prompt comes from upstream (e.g. Analyze → Read).
      </p>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Model</label>
        <input {...form.register("model")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Target language mode</label>
        <select {...form.register("targetLanguage")} className={fieldInput()}>
          <option value="auto">auto (mixed repos)</option>
          <option value="python">python / pytest</option>
          <option value="typescript">typescript / Jest–Vitest</option>
        </select>
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Preferred test style</label>
        <select {...form.register("preferredTestStyle")} className={fieldInput()}>
          <option value="auto">auto (infer per language)</option>
          <option value="pytest">pytest (Python bias)</option>
          <option value="jest">jest (JS/TS bias)</option>
          <option value="vitest">vitest (JS/TS bias)</option>
          <option value="mocha">mocha (JS bias)</option>
          <option value="junit">JUnit (JVM bias)</option>
          <option value="general">general (idiomatic, no forced runner)</option>
        </select>
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Temperature</label>
        <input type="number" step="0.1" {...form.register("temperature")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Max generated test files</label>
        <input type="number" min={1} max={30} {...form.register("maxGeneratedFiles")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Max source files in prompt</label>
        <input type="number" min={1} max={50} {...form.register("maxSourceFiles")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Max chars / source file</label>
        <input type="number" {...form.register("maxCharsPerSourceFile")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Max total input chars</label>
        <input type="number" {...form.register("maxTotalInputChars")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>LLM max tokens</label>
        <input type="number" {...form.register("llmMaxTokens")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>LLM timeout (ms)</label>
        <input type="number" {...form.register("llmTimeoutMs")} className={fieldInput()} />
      </div>
    </div>
  );
}

function CodeWriteTestFilesPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(CodeWriteTestFilesConfigSchema),
    defaultValues: CodeWriteTestFilesConfigSchema.partial().parse(cfg),
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    CodeWriteTestFilesConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
  );
  useEffect(() => {
    form.reset(CodeWriteTestFilesConfigSchema.partial().parse(cfg));
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      <p className="mb-2 text-[11px] leading-snug text-zinc-500">
        Files usually come from upstream <span className="text-zinc-400">generatedTestFiles</span>.
        Set <span className="text-zinc-400">baseDirectory</span> to an absolute or repo-relative output folder.
      </p>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Base directory</label>
        <input {...form.register("baseDirectory")} className={fieldInput()} placeholder="./tests-generated" />
      </div>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("overwrite")} /> Overwrite existing files
      </label>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("createDirectories")} /> Create parent directories
      </label>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("dryRun")} /> Dry run (log only, no writes)
      </label>
    </div>
  );
}

function GitHubRepoGenerateTestsLlmPanel(
  props: InspectorRenderProps,
): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(GitHubRepoGenerateTestsLlmConfigSchema),
    defaultValues: GitHubRepoGenerateTestsLlmConfigSchema.partial().parse(cfg),
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    GitHubRepoGenerateTestsLlmConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
    200,
    { stripOpenAiEnv: true },
  );
  useEffect(() => {
    form.reset(GitHubRepoGenerateTestsLlmConfigSchema.partial().parse(cfg));
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      <p className="mb-2 text-[11px] leading-snug text-zinc-500">
        Chain after <span className="text-zinc-400">GitHub: Analyze repo</span>
        , then to <span className="text-zinc-400">GitHub: Run tests</span>.
        LLM calls use <code className="text-zinc-400">OPENAI_API_KEY</code> /{" "}
        <code className="text-zinc-400">WFENGINE_OPENAI_BASE_URL</code> on the runner. Repo fields belong on
        Analyze — use Advanced only to override.
      </p>
      <details className="rounded-md border border-zinc-700/80 bg-zinc-900/40 p-2">
        <summary className="cursor-pointer text-xs font-medium text-zinc-400 select-none">
          Advanced: override owner / repo / ref / GitHub token
        </summary>
        <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>Owner</label>
            <input {...form.register("owner")} className={fieldInput()} />
          </div>
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>Repo</label>
            <input {...form.register("repo")} className={fieldInput()} />
          </div>
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>Ref</label>
            <input {...form.register("ref")} className={fieldInput()} />
          </div>
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>GitHub token</label>
            <SecretInput {...form.register("githubToken")} />
          </div>
        </div>
      </details>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Model</label>
        <input {...form.register("model")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Max source files (1–25)</label>
        <input
          type="number"
          min={1}
          max={25}
          {...form.register("maxSourceFiles")}
          className={fieldInput()}
        />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Max chars / file</label>
        <input type="number" {...form.register("maxCharsPerFile")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Framework</label>
        <select {...form.register("framework")} className={fieldInput()}>
          <option value="jest">jest</option>
          <option value="vitest">vitest</option>
          <option value="pytest">pytest</option>
        </select>
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Temperature</label>
        <input type="number" step="0.1" {...form.register("temperature")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>LLM max tokens</label>
        <input type="number" {...form.register("llmMaxTokens")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>LLM timeout (ms)</label>
        <input type="number" {...form.register("llmTimeoutMs")} className={fieldInput()} />
      </div>
    </div>
  );
}

function GitHubRepoAnalyzePanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(GitHubRepoAnalyzeConfigSchema),
    defaultValues: GitHubRepoAnalyzeConfigSchema.partial().parse(cfg),
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    GitHubRepoAnalyzeConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
  );
  useEffect(() => {
    form.reset(GitHubRepoAnalyzeConfigSchema.partial().parse(cfg));
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      <p className="mb-2 text-[11px] leading-snug text-zinc-500">
        The token you set here is forwarded to downstream <span className="text-zinc-400">GitHub</span> nodes
        in the same run (Read files, Run tests) when their own token is empty. Use env <code className="text-zinc-400">GITHUB_TOKEN</code> only
        if you prefer not to store a PAT in the workflow.
      </p>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Owner</label>
        <input {...form.register("owner")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Repo</label>
        <input {...form.register("repo")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Ref</label>
        <input {...form.register("ref")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>GitHub token (optional)</label>
        <SecretInput {...form.register("githubToken")} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Focus</label>
        <select {...form.register("focus")} className={fieldInput()}>
          <option value="all">all</option>
          <option value="source">source</option>
          <option value="tests">tests</option>
        </select>
      </div>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("includePackageJson")} /> Read package.json
      </label>
    </div>
  );
}

function GitHubRepoListBranchesPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(GitHubRepoListBranchesConfigSchema),
    defaultValues: GitHubRepoListBranchesConfigSchema.partial().parse(cfg),
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    GitHubRepoListBranchesConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
  );
  useEffect(() => {
    form.reset(GitHubRepoListBranchesConfigSchema.partial().parse(cfg));
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      <p className="mb-2 text-[11px] leading-snug text-zinc-500">
        After <span className="text-zinc-400">GitHub: Analyze repo</span>, owner/repo are inherited
        — configure them only on Analyze unless you need overrides below.
      </p>
      <details className="rounded-md border border-zinc-700/80 bg-zinc-900/40 p-2">
        <summary className="cursor-pointer text-xs font-medium text-zinc-400 select-none">
          Advanced: override owner / repo / token
        </summary>
        <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>Owner</label>
            <input {...form.register("owner")} className={fieldInput()} />
          </div>
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>Repo</label>
            <input {...form.register("repo")} className={fieldInput()} />
          </div>
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>GitHub token</label>
            <SecretInput {...form.register("githubToken")} />
          </div>
        </div>
      </details>
      <label className={fieldLabel("flex items-center gap-2 normal-case tracking-normal text-zinc-300")}>
        <input type="checkbox" {...form.register("includeTags")} /> Include tags
      </label>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Per page</label>
        <input type="number" {...form.register("perPage")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Max pages</label>
        <input type="number" {...form.register("maxPages")} className={fieldInput()} />
      </div>
    </div>
  );
}

function GitHubFilesReadPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const parsed = GitHubFilesReadConfigSchema.partial().parse(cfg);
  const [pathLines, setPathLines] = useState(
    () => (parsed.targetFiles ?? []).join("\n"),
  );

  const form = useForm({
    resolver: zodResolver(GitHubFilesReadConfigSchema),
    defaultValues: {
      ...parsed,
      targetFiles: parsed.targetFiles ?? [],
    },
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    GitHubFilesReadConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
  );
  useEffect(() => {
    const p = GitHubFilesReadConfigSchema.partial().parse(cfg);
    setPathLines((p.targetFiles ?? []).join("\n"));
    form.reset({
      ...p,
      targetFiles: p.targetFiles ?? [],
    });
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      <p className="mb-2 text-[11px] leading-snug text-zinc-500">
        <strong className="text-zinc-400">custom</strong>: list paths below or pass{" "}
        <code className="text-zinc-400">targetFiles</code>.{" "}
        <strong className="text-zinc-400">core</strong> / <strong className="text-zinc-400">all</strong>: chain after{" "}
        <span className="text-zinc-400">GitHub: Analyze repo</span> so merged{" "}
        <code className="text-zinc-400">sourceFiles</code> is used (ignore textarea). Set{" "}
        <code className="text-zinc-400">smartMaxFiles</code> as a cap. Owner/repo/ref usually live only on
        Analyze — expand Advanced only to override. The PAT from <span className="text-zinc-400">GitHub: Analyze repo</span>{" "}
        is forwarded automatically to this node; Advanced is for overrides or non-standard wiring.
      </p>
      <details className="rounded-md border border-zinc-700/80 bg-zinc-900/40 p-2">
        <summary className="cursor-pointer text-xs font-medium text-zinc-400 select-none">
          Advanced: override owner / ref / token
        </summary>
        <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>Owner</label>
            <input {...form.register("owner")} className={fieldInput()} />
          </div>
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>Repo</label>
            <input {...form.register("repo")} className={fieldInput()} />
          </div>
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>Ref</label>
            <input {...form.register("ref")} className={fieldInput()} />
          </div>
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>GitHub token</label>
            <SecretInput {...form.register("githubToken")} />
          </div>
        </div>
      </details>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Smart selection mode</label>
        <select {...form.register("smartSelectMode")} className={fieldInput()}>
          <option value="custom">custom — use paths below / upstream targetFiles</option>
          <option value="core">core — prioritize src/, lib/, services/, … from analyze</option>
          <option value="all">all — take application-like sources up to max</option>
        </select>
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Smart max files (core / all)</label>
        <input type="number" min={1} max={200} {...form.register("smartMaxFiles")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Repo-relative paths (one per line)</label>
        <textarea
          value={pathLines}
          onChange={(e) => {
            const v = e.target.value;
            setPathLines(v);
            const lines = v
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            form.setValue("targetFiles", lines, { shouldValidate: true });
          }}
          rows={8}
          className={fieldInput("min-h-[120px] resize-y font-mono text-xs")}
          spellCheck={false}
        />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Max chars per file</label>
        <input type="number" {...form.register("maxCharsPerFile")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Max total chars (all files)</label>
        <input type="number" {...form.register("maxTotalChars")} className={fieldInput()} />
      </div>
    </div>
  );
}

function GitHubRepoRunTestsPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const form = useForm({
    resolver: zodResolver(GitHubRepoRunTestsConfigSchema),
    defaultValues: GitHubRepoRunTestsConfigSchema.partial().parse(cfg),
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    GitHubRepoRunTestsConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
  );
  useEffect(() => {
    form.reset(GitHubRepoRunTestsConfigSchema.partial().parse(cfg));
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      <p className="mb-2 text-[11px] leading-snug text-zinc-500">
        After <span className="text-zinc-400">Analyze</span> → <span className="text-zinc-400">Read</span> →{" "}
        <span className="text-zinc-400">LLM</span>, repo identity and the GitHub PAT flow forward — set them once on{" "}
        <span className="text-zinc-400">Analyze</span> unless you override below.
      </p>
      <details className="rounded-md border border-zinc-700/80 bg-zinc-900/40 p-2">
        <summary className="cursor-pointer text-xs font-medium text-zinc-400 select-none">
          Advanced: override owner / repo / ref / token
        </summary>
        <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>Owner</label>
            <input {...form.register("owner")} className={fieldInput()} />
          </div>
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>Repo</label>
            <input {...form.register("repo")} className={fieldInput()} />
          </div>
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>Ref</label>
            <input {...form.register("ref")} className={fieldInput()} />
          </div>
          <div className={fieldGroup()}>
            <label className={fieldLabel()}>GitHub token</label>
            <SecretInput {...form.register("githubToken")} />
          </div>
        </div>
      </details>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Test command</label>
        <input {...form.register("testCommand")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Package folder (monorepo)</label>
        <input
          {...form.register("repoSubpath")}
          placeholder="e.g. web_monitor_api"
          className={fieldInput()}
        />
        <p className="mt-1 text-[10px] leading-snug text-zinc-600">
          Path under the repo root where <code className="text-zinc-500">package.json</code> lives.
          Leave empty if the repo root is the npm package.
        </p>
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Working directory (local clone)</label>
        <input {...form.register("workingDirectory")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Timeout (ms)</label>
        <input type="number" {...form.register("timeout")} className={fieldInput()} />
      </div>
    </div>
  );
}

const DEFAULT_MFA_AGENTS = [
  {
    name: "researcher",
    systemPrompt:
      "Read the upstream workflow JSON and summarize facts relevant to the task.",
  },
  {
    name: "reviewer",
    systemPrompt:
      "Critique the researcher’s summary and note risks or missing checks.",
  },
];

const DEFAULT_MULTI_AGENTS = [
  {
    name: "planner",
    systemPrompt: "Propose a short plan based on the upstream payload.",
  },
  {
    name: "executor",
    systemPrompt: "Turn the plan into concrete actionable steps.",
  },
];

function MfaAgentGroupPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const parsed = MfaAgentGroupConfigSchema.partial().safeParse(cfg);

  const form = useForm({
    defaultValues: {
      groupName: parsed.success ? (parsed.data.groupName ?? "") : "",
      orchestrationMode:
        (parsed.success ? parsed.data.orchestrationMode : undefined) ??
        "sequential",
      llmProvider:
        (parsed.success ? parsed.data.llmProvider : undefined) ?? "openai",
      openAiBaseUrl: parsed.success ? (parsed.data.openAiBaseUrl ?? "") : "",
      openAiApiKey: parsed.success ? (parsed.data.openAiApiKey ?? "") : "",
      ollamaBaseUrl: parsed.success ? (parsed.data.ollamaBaseUrl ?? "") : "",
      model: parsed.success ? (parsed.data.model ?? "gpt-4o-mini") : "gpt-4o-mini",
      temperature: parsed.success ? (parsed.data.temperature ?? 0.3) : 0.3,
      timeoutMs: parsed.success ? (parsed.data.timeoutMs ?? 180_000) : 180_000,
      taskInstructions: parsed.success
        ? (parsed.data.taskInstructions ?? "")
        : "",
    },
  });

  const [agentsJson, setAgentsJson] = useState(() =>
    JSON.stringify(
      parsed.success && parsed.data.agents?.length
        ? parsed.data.agents
        : DEFAULT_MFA_AGENTS,
      null,
      2,
    ),
  );

  const vals = useWatch({ control: form.control });

  useEffect(() => {
    const p = MfaAgentGroupConfigSchema.partial().safeParse(cfg);
    const agents =
      p.success && p.data.agents?.length ? p.data.agents : DEFAULT_MFA_AGENTS;
    setAgentsJson(JSON.stringify(agents, null, 2));
    form.reset({
      groupName: p.success ? (p.data.groupName ?? "") : "",
      orchestrationMode:
        (p.success ? p.data.orchestrationMode : undefined) ?? "sequential",
      llmProvider: (p.success ? p.data.llmProvider : undefined) ?? "openai",
      openAiBaseUrl: p.success ? (p.data.openAiBaseUrl ?? "") : "",
      openAiApiKey: p.success ? (p.data.openAiApiKey ?? "") : "",
      ollamaBaseUrl: p.success ? (p.data.ollamaBaseUrl ?? "") : "",
      model: p.success ? (p.data.model ?? "gpt-4o-mini") : "gpt-4o-mini",
      temperature: p.success ? (p.data.temperature ?? 0.3) : 0.3,
      timeoutMs: p.success ? (p.data.timeoutMs ?? 180_000) : 180_000,
      taskInstructions: p.success ? (p.data.taskInstructions ?? "") : "",
    });
  }, [selectedNode.id, cfg, form]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      let raw: unknown;
      try {
        raw = JSON.parse(agentsJson);
      } catch {
        return;
      }
      const agents = z.array(AgentPersonaSchema).safeParse(raw);
      if (!agents.success) return;
      const merged = {
        ...(vals ?? {}),
        agents: agents.data,
      };
      const full = MfaAgentGroupConfigSchema.safeParse(merged);
      if (full.success) {
        updateNodeConfig(
          selectedNode.id,
          stripOpenAiEnvFromConfig(full.data as Record<string, unknown>),
        );
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [agentsJson, vals, selectedNode.id, updateNodeConfig]);

  const orchestrationMode = vals?.orchestrationMode ?? "sequential";
  const llmProvider = vals?.llmProvider ?? "openai";

  const pushAgentsJson = (next: string) => {
    setAgentsJson(next);
  };

  return (
    <div className="mt-2 space-y-4">
      <p className="text-[11px] leading-snug text-zinc-500">
        OpenAI-compatible API on the <strong>runner</strong>. Upstream outputs are merged into JSON
        context for every turn.
      </p>

      <div className={orchestrationCardClass}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/85">
          Orchestration mode
        </p>
        <select
          {...form.register("orchestrationMode")}
          className={cn(fieldInput(), "mt-2")}
        >
          <option value="sequential">Sequential — each agent once in order</option>
          <option value="single_completion">Single JSON completion — one API call</option>
        </select>
        <MfaOrchestrationModeHint mode={orchestrationMode} />
      </div>

      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Add agents</label>
        <p className="mb-2 text-[10px] leading-snug text-zinc-500">
          The agent list lives on the canvas node — edit, delete, or reorder there. Use these shortcuts or Advanced JSON.
        </p>
        <AddAgentToolbar
          libraryEntries={props.agentLibraryEntries}
          onPickLibraryEntry={(entry) =>
            pushAgentsJson(appendPersonaFromLibrary(agentsJson, entry))
          }
          onAddBlank={() => pushAgentsJson(appendBlankPersona(agentsJson))}
          onOpenAgentLibrary={props.onOpenAgentLibrary}
        />
      </div>

      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Group name (optional)</label>
        <input {...form.register("groupName")} className={fieldInput()} />
      </div>
      <LlmProviderSection
        provider={llmProvider}
        providerField={form.register("llmProvider")}
        openAiBaseUrlField={form.register("openAiBaseUrl")}
        openAiApiKeyField={form.register("openAiApiKey")}
        ollamaBaseUrlField={form.register("ollamaBaseUrl")}
      />
      <OllamaAwareModelField
        label="Model (shared)"
        provider={llmProvider}
        ollamaBaseUrl={vals?.ollamaBaseUrl}
        model={vals?.model}
        modelField={form.register("model")}
        setModel={(value) =>
          form.setValue("model", value, { shouldDirty: true })
        }
      />
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Temperature</label>
        <input type="number" step="0.1" {...form.register("temperature")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Timeout (ms)</label>
        <input type="number" {...form.register("timeoutMs")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Extra task instructions</label>
        <textarea {...form.register("taskInstructions")} rows={3} className={fieldInput("min-h-[56px] text-xs")} />
      </div>

      <details className="rounded-xl border border-white/[0.06] bg-[#14141a] px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Advanced — personas JSON
        </summary>
        <p className="mb-2 mt-2 text-[10px] leading-snug text-zinc-500">
          Edit raw persona objects when you need full control. With <code className="text-zinc-400">libraryAgentId</code>,{" "}
          <code className="text-zinc-400">systemPrompt</code> may be omitted.
        </p>
        <textarea
          value={agentsJson}
          onChange={(e) => setAgentsJson(e.target.value)}
          rows={10}
          spellCheck={false}
          className={fieldInput("min-h-[140px] font-mono text-xs")}
        />
      </details>
    </div>
  );
}

/** Single-agent nodes must not use `agents[]`; normalize invalid pasted JSON. */
function sanitizeAutogenSingleAgentConfig(c: Record<string, unknown>): {
  next: Record<string, unknown>;
  hadMultiplePersonas: boolean;
} {
  const agents = c.agents;
  if (!Array.isArray(agents)) {
    return { next: { ...c }, hadMultiplePersonas: false };
  }
  if (agents.length === 0) {
    const next = { ...c };
    delete next.agents;
    return { next, hadMultiplePersonas: false };
  }
  const hadMultiplePersonas = agents.length > 1;
  const next: Record<string, unknown> = { ...c };
  delete next.agents;
  const first = agents[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const o = first as Record<string, unknown>;
    if (typeof o.name === "string" && o.name.trim()) next.agentName = o.name;
    if (typeof o.systemPrompt === "string") next.systemPrompt = o.systemPrompt;
    if (typeof o.libraryAgentId === "string")
      next.libraryAgentId = o.libraryAgentId;
  }
  return { next, hadMultiplePersonas };
}

function AutogenAgentPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const [showMultiAgentFixBanner, setShowMultiAgentFixBanner] = useState(false);

  const form = useForm({
    resolver: zodResolver(AutogenAgentConfigSchema),
    defaultValues: AutogenAgentConfigPartialSchema.parse(cfg),
  });
  const vals = useWatch({ control: form.control });
  useDebouncedValidConfig(
    vals ?? {},
    AutogenAgentConfigSchema,
    selectedNode.id,
    updateNodeConfig,
    cfg,
    200,
    { stripOpenAiEnv: true },
  );
  useEffect(() => {
    setShowMultiAgentFixBanner(false);
  }, [selectedNode.id]);

  useEffect(() => {
    const raw = (selectedNode.data.config ?? {}) as Record<string, unknown>;
    if (!Array.isArray(raw.agents)) return;
    const { next, hadMultiplePersonas } = sanitizeAutogenSingleAgentConfig(raw);
    if (hadMultiplePersonas) {
      setShowMultiAgentFixBanner(true);
      toast.warning(
        "This step only supports one agent. Extra personas were removed; the first was kept.",
      );
    }
    updateNodeConfig(selectedNode.id, next);
  }, [selectedNode.id, selectedNode.data.config, updateNodeConfig]);

  useEffect(() => {
    form.reset(AutogenAgentConfigPartialSchema.parse(cfg));
  }, [selectedNode.id, cfg, form]);

  const runtimeVal = (vals?.runtime as string | undefined) ?? "openai_compatible";
  const libraryAgentId = vals?.libraryAgentId as string | undefined;
  const llmProvider = vals?.llmProvider ?? "openai";

  return (
    <div className="mt-2 space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/50 to-[#14141a] px-3 py-3 ring-1 ring-cyan-500/15">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/30">
          <Bot className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/95">
            Single Agent
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
            One LLM per run. API key on the runner (
            <code className="text-zinc-400">OPENAI_API_KEY</code>).
          </p>
        </div>
      </div>

      {showMultiAgentFixBanner ? (
        <div className="rounded-xl border border-amber-500/35 bg-amber-950/30 px-3 py-2.5 text-[12px] leading-snug text-amber-100/95">
          <span className="font-medium text-amber-50">Invalid config:</span> an{" "}
          <code className="rounded bg-black/30 px-1 text-[11px]">agents</code> list was
          found; only the first entry was kept for this single-agent step.
          <button
            type="button"
            className="ml-2 text-amber-200/90 underline decoration-amber-500/50 hover:text-white"
            onClick={() => setShowMultiAgentFixBanner(false)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200/80">
          Runtime
        </p>
        <select {...form.register("runtime")} className={cn(fieldInput(), "mt-2")}>
          <option value="openai_compatible">OpenAI-compatible (Node)</option>
          <option value="python_autogen">Python AutoGen bridge</option>
        </select>
        <SingleAgentRuntimeHint runtime={runtimeVal} />
      </div>

      <input type="hidden" {...form.register("libraryAgentId")} />

      {libraryAgentId ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#16161e] px-3 py-2.5">
          <p className="text-[11px] leading-snug text-zinc-400">
            <span className="font-medium text-zinc-300">Agent Library</span> —{" "}
            <span className="font-mono text-cyan-300/90">{libraryAgentId}</span>
          </p>
          <button
            type="button"
            className="mt-2 text-[11px] font-medium text-cyan-300/90 underline decoration-cyan-500/40 hover:text-cyan-200"
            onClick={() => {
              form.setValue("libraryAgentId", undefined, { shouldDirty: true });
            }}
          >
            Detach and use inline fields only
          </button>
        </div>
      ) : null}

      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Agent name</label>
        <input {...form.register("agentName")} className={fieldInput()} />
      </div>
      <LlmProviderSection
        provider={llmProvider}
        providerField={form.register("llmProvider")}
        openAiBaseUrlField={form.register("openAiBaseUrl")}
        openAiApiKeyField={form.register("openAiApiKey")}
        ollamaBaseUrlField={form.register("ollamaBaseUrl")}
      />
      <OllamaAwareModelField
        provider={llmProvider}
        ollamaBaseUrl={vals?.ollamaBaseUrl}
        model={vals?.model}
        modelField={form.register("model")}
        setModel={(value) =>
          form.setValue("model", value, { shouldDirty: true })
        }
      />
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>System prompt</label>
        <textarea {...form.register("systemPrompt")} rows={5} className={fieldInput("min-h-[80px] text-xs")} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className={fieldGroup("mb-0")}>
          <label className={fieldLabel()}>Temperature</label>
          <input type="number" step="0.1" {...form.register("temperature")} className={fieldInput()} />
        </div>
        <div className={fieldGroup("mb-0")}>
          <label className={fieldLabel()}>Timeout (ms)</label>
          <input type="number" {...form.register("timeoutMs")} className={fieldInput()} />
        </div>
      </div>

      <details className="rounded-xl border border-white/[0.06] bg-[#14141a] px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Advanced — tools & Python bridge
        </summary>
        <div className="mt-3 space-y-3">
          <div className={fieldGroup("mb-0")}>
            <label className={fieldLabel()}>Tools</label>
            <AgentToolsPicker
              tools={vals?.tools as AgentToolRef[] | undefined}
              onChange={(next) =>
                form.setValue("tools", next, { shouldDirty: true })
              }
              workflowNodes={props.workflowNodes}
              excludeNodeIds={[selectedNode.id]}
              agentLibraryEntries={props.agentLibraryEntries ?? []}
            />
          </div>
          <div className={fieldGroup("mb-0")}>
            <label className={fieldLabel()}>Python executable</label>
            <input {...form.register("pythonExecutable")} className={fieldInput()} placeholder="python3" />
          </div>
          <div className={fieldGroup("mb-0")}>
            <label className={fieldLabel()}>Python module path</label>
            <input {...form.register("pythonModulePath")} className={fieldInput()} placeholder="my_pkg.autogen_runner" />
          </div>
        </div>
      </details>
    </div>
  );
}

function formatForceToolsIndicesForForm(raw: unknown): string {
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === "number")) {
    return "";
  }
  return (raw as number[]).join(", ");
}

type AutogenMultiAgentFormVals = {
  teamName: string;
  llmProvider: "openai" | "ollama";
  openAiBaseUrl: string;
  openAiApiKey: string;
  ollamaBaseUrl: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  maxTurns: number;
  taskInstructions: string;
  runtime: "orchestrated_openai" | "python_autogen";
  pythonExecutable: string;
  pythonModulePath: string;
  tools: AgentToolRef[];
  stopMode: "max_turns" | "termination_token";
  multiAgentToolBinding:
    | ""
    | "openai_tools_auto"
    | "pipeline_last_turn_tools_required";
  forceToolsOnTurns: string;
};

function toolBindingFromCfg(
  raw: unknown,
): "" | "openai_tools_auto" | "pipeline_last_turn_tools_required" {
  if (raw === "pipeline_last_turn_tools_required") {
    return "pipeline_last_turn_tools_required";
  }
  if (raw === "openai_tools_auto") {
    return "openai_tools_auto";
  }
  return "";
}

function AutogenMultiAgentPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode, updateNodeConfig } = props;
  if (!selectedNode) return <></>;
  const cfg = selectedNode.data.config ?? {};
  const cfgRec = cfg as Record<string, unknown>;
  const parsed = AutogenMultiAgentConfigSchema.partial().safeParse(cfg);

  const form = useForm<AutogenMultiAgentFormVals>({
    defaultValues: {
      teamName: parsed.success ? (parsed.data.teamName ?? "") : "",
      llmProvider:
        (parsed.success ? parsed.data.llmProvider : undefined) ?? "openai",
      openAiBaseUrl: parsed.success ? (parsed.data.openAiBaseUrl ?? "") : "",
      openAiApiKey: parsed.success ? (parsed.data.openAiApiKey ?? "") : "",
      ollamaBaseUrl: parsed.success ? (parsed.data.ollamaBaseUrl ?? "") : "",
      model: parsed.success ? (parsed.data.model ?? "gpt-4o-mini") : "gpt-4o-mini",
      temperature: parsed.success ? (parsed.data.temperature ?? 0.3) : 0.3,
      timeoutMs: parsed.success ? (parsed.data.timeoutMs ?? 240_000) : 240_000,
      maxTurns: parsed.success ? (parsed.data.maxTurns ?? 8) : 8,
      taskInstructions: parsed.success ? (parsed.data.taskInstructions ?? "") : "",
      runtime:
        (parsed.success ? parsed.data.runtime : undefined) ??
        "orchestrated_openai",
      pythonExecutable: parsed.success
        ? (parsed.data.pythonExecutable ?? "")
        : "",
      pythonModulePath: parsed.success
        ? (parsed.data.pythonModulePath ?? "")
        : "",
      tools: parsed.success ? (parsed.data.tools ?? []) : [],
      stopMode: parsed.success
        ? (parsed.data.stopMode ?? "max_turns")
        : "max_turns",
      multiAgentToolBinding: toolBindingFromCfg(
        cfgRec["multiAgentToolBinding"],
      ),
      forceToolsOnTurns: formatForceToolsIndicesForForm(
        cfgRec["forceToolsFirstCompletionOnTurnIndices"],
      ),
    },
  });

  const [agentsJson, setAgentsJson] = useState(() =>
    JSON.stringify(
      parsed.success && parsed.data.agents && parsed.data.agents.length >= 2
        ? parsed.data.agents
        : DEFAULT_MULTI_AGENTS,
      null,
      2,
    ),
  );

  const vals = useWatch({ control: form.control });

  useEffect(() => {
    const p = AutogenMultiAgentConfigSchema.partial().safeParse(cfg);
    const agents =
      p.success && p.data.agents && p.data.agents.length >= 2
        ? p.data.agents
        : DEFAULT_MULTI_AGENTS;
    setAgentsJson(JSON.stringify(agents, null, 2));
    const nextCfg = cfg as Record<string, unknown>;
    form.reset({
      teamName: p.success ? (p.data.teamName ?? "") : "",
      llmProvider: (p.success ? p.data.llmProvider : undefined) ?? "openai",
      openAiBaseUrl: p.success ? (p.data.openAiBaseUrl ?? "") : "",
      openAiApiKey: p.success ? (p.data.openAiApiKey ?? "") : "",
      ollamaBaseUrl: p.success ? (p.data.ollamaBaseUrl ?? "") : "",
      model: p.success ? (p.data.model ?? "gpt-4o-mini") : "gpt-4o-mini",
      temperature: p.success ? (p.data.temperature ?? 0.3) : 0.3,
      timeoutMs: p.success ? (p.data.timeoutMs ?? 240_000) : 240_000,
      maxTurns: p.success ? (p.data.maxTurns ?? 8) : 8,
      taskInstructions: p.success ? (p.data.taskInstructions ?? "") : "",
      runtime:
        (p.success ? p.data.runtime : undefined) ?? "orchestrated_openai",
      pythonExecutable: p.success ? (p.data.pythonExecutable ?? "") : "",
      pythonModulePath: p.success ? (p.data.pythonModulePath ?? "") : "",
      tools: p.success ? (p.data.tools ?? []) : [],
      stopMode: p.success ? (p.data.stopMode ?? "max_turns") : "max_turns",
      multiAgentToolBinding: toolBindingFromCfg(
        nextCfg["multiAgentToolBinding"],
      ),
      forceToolsOnTurns: formatForceToolsIndicesForForm(
        nextCfg["forceToolsFirstCompletionOnTurnIndices"],
      ),
    });
  }, [selectedNode.id, cfg, form]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      let raw: unknown;
      try {
        raw = JSON.parse(agentsJson);
      } catch {
        return;
      }
      const agents = z.array(AgentPersonaSchema).safeParse(raw);
      if (!agents.success || agents.data.length < 2) return;
      const v = (vals ?? {}) as Record<string, unknown>;
      const ftsRaw =
        typeof v.forceToolsOnTurns === "string" ? v.forceToolsOnTurns.trim() : "";
      const forceToolsFirstCompletionOnTurnIndices =
        ftsRaw.length > 0
          ? ftsRaw
              .split(/[,;\s]+/)
              .map((s) => Number.parseInt(s.trim(), 10))
              .filter((n) => Number.isFinite(n) && n >= 0)
          : undefined;
      const {
        forceToolsOnTurns: _drop,
        multiAgentToolBinding: mbRaw,
        ...restVals
      } = v;
      const merged: Record<string, unknown> = {
        ...restVals,
        agents: agents.data,
      };
      if (
        mbRaw === "openai_tools_auto" ||
        mbRaw === "pipeline_last_turn_tools_required"
      ) {
        merged.multiAgentToolBinding = mbRaw;
      }
      if (forceToolsFirstCompletionOnTurnIndices?.length) {
        merged.forceToolsFirstCompletionOnTurnIndices =
          forceToolsFirstCompletionOnTurnIndices;
      }
      const full = AutogenMultiAgentConfigSchema.safeParse(merged);
      if (full.success) {
        updateNodeConfig(
          selectedNode.id,
          stripOpenAiEnvFromConfig(full.data as Record<string, unknown>),
        );
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [agentsJson, vals, selectedNode.id, updateNodeConfig]);

  const rt = vals?.runtime ?? "orchestrated_openai";
  const maxTurnsVal = vals?.maxTurns ?? 8;
  const llmProvider = vals?.llmProvider ?? "openai";

  const pushAgentsJson = (next: string) => {
    setAgentsJson(next);
  };

  return (
    <div className="mt-2 space-y-4">
      <p className="text-[11px] leading-snug text-zinc-500">
        Needs <strong>at least two</strong> agents. Round-robin alternates personas up to max turns, or use the Python bridge.
      </p>

      <div className={orchestrationCardClass}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/85">
          Orchestration
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className={fieldGroup("mb-0")}>
            <label className={fieldLabel()}>Runtime</label>
            <select {...form.register("runtime")} className={fieldInput()}>
              <option value="orchestrated_openai">Round-robin (Node)</option>
              <option value="python_autogen">Python AutoGen bridge</option>
            </select>
          </div>
          <div className={fieldGroup("mb-0")}>
            <label className={fieldLabel()}>Max turns</label>
            <input type="number" {...form.register("maxTurns")} className={fieldInput()} />
          </div>
        </div>
        <AutogenMultiOrchestrationHint runtime={rt} maxTurns={maxTurnsVal} />
      </div>

      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Add agents</label>
        <p className="mb-2 text-[10px] leading-snug text-zinc-500">
          The team roster is shown on the canvas node (≥2 agents). Use shortcuts below or Advanced JSON.
        </p>
        <AddAgentToolbar
          libraryEntries={props.agentLibraryEntries}
          onPickLibraryEntry={(entry) =>
            pushAgentsJson(appendPersonaFromLibrary(agentsJson, entry))
          }
          onAddBlank={() => pushAgentsJson(appendBlankPersona(agentsJson))}
          onOpenAgentLibrary={props.onOpenAgentLibrary}
        />
      </div>

      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Team name</label>
        <input {...form.register("teamName")} className={fieldInput()} />
      </div>
      <LlmProviderSection
        provider={llmProvider}
        providerField={form.register("llmProvider")}
        openAiBaseUrlField={form.register("openAiBaseUrl")}
        openAiApiKeyField={form.register("openAiApiKey")}
        ollamaBaseUrlField={form.register("ollamaBaseUrl")}
      />
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Shared tools</label>
        <AgentToolsPicker
          tools={vals?.tools as AgentToolRef[] | undefined}
          onChange={(next) =>
            form.setValue("tools", next, { shouldDirty: true })
          }
          workflowNodes={props.workflowNodes}
          excludeNodeIds={[selectedNode.id]}
          agentLibraryEntries={props.agentLibraryEntries ?? []}
        />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Tool binding (gen-AI vs pipeline)</label>
        <p className="mb-1.5 text-[10px] leading-snug text-zinc-500">
          <strong>OpenAI auto</strong>: model may reply with text and never call workflow tools (then
          agent-invoke-only graph steps fail with an explicit error). <strong>Pipeline last turn</strong>: when max turns equals team size,
          the last turn must start with a tool call (<code className="text-zinc-400">tool_choice: required</code>
          first completion).
        </p>
        <select
          {...form.register("multiAgentToolBinding")}
          className={fieldInput()}
        >
          <option value="">
            Auto — infer when tools target agent-invoke-only nodes & maxTurns = team size
          </option>
          <option value="openai_tools_auto">OpenAI — tools optional (auto)</option>
          <option value="pipeline_last_turn_tools_required">
            Pipeline — require tools on last turn (maxTurns = agent count)
          </option>
        </select>
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Force tools on turns (optional)</label>
        <p className="mb-1.5 text-[10px] leading-snug text-zinc-500">
          Comma-separated <strong>0-based</strong> round-robin indices (e.g.{" "}
          <code className="text-zinc-400">2</code> for the 3rd agent). First API
          response on those turns uses <code className="text-zinc-400">tool_choice: required</code>{" "}
          so the model must call at least one workflow tool.
        </p>
        <input
          {...form.register("forceToolsOnTurns")}
          className={fieldInput()}
          placeholder="e.g. 2"
          spellCheck={false}
        />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Task instructions</label>
        <textarea {...form.register("taskInstructions")} rows={2} className={fieldInput("text-xs")} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Stop mode</label>
        <select {...form.register("stopMode")} className={fieldInput()}>
          <option value="max_turns">Max turns (default)</option>
          <option value="termination_token">Termination token (Phase 2)</option>
        </select>
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Python executable</label>
        <input {...form.register("pythonExecutable")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Python module path</label>
        <input {...form.register("pythonModulePath")} className={fieldInput()} />
      </div>
      <OllamaAwareModelField
        label="Model (shared)"
        provider={llmProvider}
        ollamaBaseUrl={vals?.ollamaBaseUrl}
        model={vals?.model}
        modelField={form.register("model")}
        setModel={(value) =>
          form.setValue("model", value, { shouldDirty: true })
        }
      />
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Temperature</label>
        <input type="number" step="0.1" {...form.register("temperature")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>Timeout (ms)</label>
        <input type="number" {...form.register("timeoutMs")} className={fieldInput()} />
      </div>

      <details className="rounded-xl border border-white/[0.06] bg-[#14141a] px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Advanced — team personas JSON
        </summary>
        <p className="mb-2 mt-2 text-[10px] leading-snug text-zinc-500">
          Raw persona array. Requires ≥2 agents. With <code className="text-zinc-400">libraryAgentId</code>,{" "}
          <code className="text-zinc-400">systemPrompt</code> may be omitted.
        </p>
        <textarea
          value={agentsJson}
          onChange={(e) => setAgentsJson(e.target.value)}
          rows={10}
          spellCheck={false}
          className={fieldInput("min-h-[140px] font-mono text-xs")}
        />
      </details>
    </div>
  );
}

/**
 * Structured editors backed by the same Zod schemas as `@wfengine/nodes-base`.
 * Unknown types fall back to JSON.
 */
export function NodeConfigPanel(props: InspectorRenderProps): ReactElement {
  const { selectedNode } = props;
  const wfType = selectedNode?.data.wfType;

    switch (wfType) {
    case "trigger.webhook":
      return (
        <EmptyNote title="Webhook passes the HTTP body as initial data — no fields to configure here." />
      );
    case "noop":
      return (
        <EmptyNote title="Passes input through — no configuration." />
      );
    case "trigger.cron":
      return <CronPanel {...props} />;
    case "http.request":
      return <HttpPanel {...props} />;
    case "email.send":
      return <EmailSendPanel {...props} />;
    case "email.read":
      return <EmailReadPanel {...props} />;
    case "slack.send":
      return selectedNode ? (
        <SlackPanel key={selectedNode.id} {...props} />
      ) : (
        <></>
      );
    case "postgres.query":
      return <PostgresPanel {...props} />;
    case "file.read":
      return <FileReadPanel {...props} />;
    case "file.write":
      return <FileWritePanel {...props} />;
    case "github.repo.list-branches":
      return <GitHubRepoListBranchesPanel {...props} />;
    case "github.files.read":
      return selectedNode ? (
        <GitHubFilesReadPanel key={selectedNode.id} {...props} />
      ) : (
        <></>
      );
    case "github.repo.analyze":
      return <GitHubRepoAnalyzePanel {...props} />;
    case "github.repo.generate-tests-llm":
      return selectedNode ? (
        <GitHubRepoGenerateTestsLlmPanel key={selectedNode.id} {...props} />
      ) : (
        <></>
      );
    case "llm.generate-unit-tests":
      return selectedNode ? (
        <LlmGenerateUnitTestsPanel key={selectedNode.id} {...props} />
      ) : (
        <></>
      );
    case "code.write-test-files":
      return selectedNode ? (
        <CodeWriteTestFilesPanel key={selectedNode.id} {...props} />
      ) : (
        <></>
      );
    case "github.repo.run-tests":
      return <GitHubRepoRunTestsPanel {...props} />;
    case "mfa.agent-group":
      return <MfaAgentGroupPanel {...props} />;
    case "autogen.agent":
      return selectedNode ? (
        <AutogenAgentPanel key={selectedNode.id} {...props} />
      ) : (
        <></>
      );
    case "autogen.multi-agent":
      return selectedNode ? (
        <AutogenMultiAgentPanel key={selectedNode.id} {...props} />
      ) : (
        <></>
      );
    default:
      return <JsonFallback {...props} />;
  }
}
