import { zodResolver } from "@hookform/resolvers/zod";
import { cn, type InspectorRenderProps } from "@wfengine/ui";
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
import { Eye, EyeOff } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from "react";
import { useForm, useWatch, type FieldValues } from "react-hook-form";
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
): void {
  const mergeRef = useRef(mergeBase);
  mergeRef.current = mergeBase;

  useEffect(() => {
    const t = window.setTimeout(() => {
      const base = mergeRef.current;
      const full = schema.safeParse(watchValues);
      if (full.success) {
        updateNodeConfig(nodeId, full.data as Record<string, unknown>);
        return;
      }
      if (schema instanceof z.ZodObject) {
        const partialResult = schema.partial().safeParse(watchValues);
        if (partialResult.success) {
          const merged: Record<string, unknown> = { ...base };
          for (const [key, val] of Object.entries(partialResult.data)) {
            if (val !== undefined) {
              merged[key] = val;
            }
          }
          updateNodeConfig(nodeId, merged);
        }
      }
    }, debounceMs);
    return () => window.clearTimeout(t);
  }, [watchValues, schema, nodeId, updateNodeConfig, debounceMs]);
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
        file. Set <code className="text-zinc-400">OPENAI_API_KEY</code> on the runner. Repo identity for
        the prompt comes from upstream (e.g. Analyze → Read); no separate git fields here.
      </p>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>OpenAI base URL</label>
        <input {...form.register("openAiBaseUrl")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>OpenAI API key</label>
        <SecretInput {...form.register("openAiApiKey")} />
      </div>
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
  );
  useEffect(() => {
    form.reset(GitHubRepoGenerateTestsLlmConfigSchema.partial().parse(cfg));
  }, [selectedNode.id, cfg, form]);

  return (
    <div className="mt-2 space-y-3">
      <p className="mb-2 text-[11px] leading-snug text-zinc-500">
        Chain after <span className="text-zinc-400">GitHub: Analyze repo</span>
        , then to <span className="text-zinc-400">GitHub: Run tests</span>.
        Requires{" "}
        <code className="text-zinc-400">OPENAI_API_KEY</code>-style key (or
        compatible endpoint). Repo fields belong on Analyze — use Advanced only to
        override.
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
        <label className={fieldLabel()}>OpenAI base URL</label>
        <input {...form.register("openAiBaseUrl")} className={fieldInput()} />
      </div>
      <div className={fieldGroup()}>
        <label className={fieldLabel()}>OpenAI API key</label>
        <SecretInput {...form.register("openAiApiKey")} />
      </div>
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
    default:
      return <JsonFallback {...props} />;
  }
}
