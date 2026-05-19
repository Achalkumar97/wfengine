import type { PaletteNodeMeta } from "@wfengine/ui";

/** Studio palette — Triggers, Actions, Data (+ Integrations legacy bucket if needed) */
export const STUDIO_PALETTE: PaletteNodeMeta[] = [
  {
    type: "trigger.webhook",
    label: "Webhook",
    category: "Triggers",
    description: "Start from HTTP POST/GET — body becomes initial payload.",
    icon: "webhook",
  },
  {
    type: "trigger.cron",
    label: "Cron",
    category: "Triggers",
    description: "Schedule expression for timed runs.",
    icon: "clock",
  },
  {
    type: "http.request",
    label: "HTTP Request",
    category: "Actions",
    description: "GET/POST JSON or text to external APIs.",
    icon: "globe",
  },
  {
    type: "noop",
    label: "Pass-through",
    category: "Actions",
    description: "Passes data through — useful for wiring tests.",
    icon: "circle-dot",
  },
  {
    type: "email.send",
    label: "Send Email",
    category: "Actions",
    description: "SMTP send via Nodemailer.",
    icon: "mail",
  },
  {
    type: "email.read",
    label: "Read Email (IMAP)",
    category: "Actions",
    description: "Fetch mailbox messages over IMAP.",
    icon: "inbox",
  },
  {
    type: "slack.send",
    label: "Send Slack",
    category: "Actions",
    description: "Post a message with a bot token.",
    icon: "message-square",
  },
  {
    type: "postgres.query",
    label: "Postgres Query",
    category: "Data",
    description: "Run SQL against PostgreSQL.",
    icon: "database",
  },
  {
    type: "file.read",
    label: "Read File",
    category: "Data",
    description: "Read a file under an optional base directory.",
    icon: "file-input",
  },
  {
    type: "file.write",
    label: "Write File",
    category: "Data",
    description: "Write text or binary to path.",
    icon: "file-output",
  },
  {
    type: "github.repo.list-branches",
    label: "GitHub: List branches",
    category: "GitHub",
    description:
      "List branch and tag names for a repo so you can set a valid ref.",
    icon: "list-tree",
  },
  {
    type: "github.repo.analyze",
    label: "GitHub: Analyze repo",
    category: "GitHub",
    description:
      "Fetch tree, detect test runners from package.json, and suggest tests (rule-based).",
    icon: "github",
  },
  {
    type: "github.files.read",
    label: "GitHub: Read files",
    category: "Testing",
    description:
      "Pipeline step 1 — omit owner/repo/ref when placed after Analyze (inherits `gitOwner`/`gitRepo`/`gitRef`). Smart core/all + analyze `sourceFiles`. Outputs `files` + flat repo echo for downstream.",
    icon: "file-input",
  },
  {
    type: "llm.generate-unit-tests",
    label: "LLM: Generate unit tests",
    category: "Testing",
    description:
      "Pipeline step 2 — multi-language & framework-aware (Go, Java, C#, Rust, …). After Read files: merged `files` → `generatedTestFiles` with `framework` + `language`. OpenAI-compatible API.",
    icon: "sparkles",
  },
  {
    type: "code.write-test-files",
    label: "Code: Write test files",
    category: "Testing",
    description:
      "Pipeline step 3 — consumes `generatedTestFiles` and writes them under `baseDirectory` (safe paths, optional dry run).",
    icon: "file-output",
  },
  {
    type: "github.repo.generate-tests-llm",
    label: "GitHub: Generate tests (LLM)",
    category: "Testing",
    description:
      "Alternative path: fetch sources from GitHub inside this node, then emit tests for `github.repo.run-tests`.",
    icon: "sparkles",
  },
  {
    type: "github.repo.run-tests",
    label: "GitHub: Run tests",
    category: "Testing",
    description:
      "Clone (or local path) and run an allowlisted test command with parsed results.",
    icon: "test-tube",
  },
  {
    type: "mfa.agent-group",
    label: "MAF: Agent group",
    category: "AI Agents",
    description:
      "Microsoft Agent Framework–style multi-agent group over upstream JSON with OpenAI or Ollama.",
    icon: "users-round",
  },
  {
    type: "autogen.agent",
    label: "AutoGen: Single agent",
    category: "AI Agents",
    description:
      "One AutoGen-style agent step with OpenAI/Ollama chat or optional Python AutoGen bridge.",
    icon: "bot",
  },
  {
    type: "autogen.multi-agent",
    label: "AutoGen: Multi-agent",
    category: "AI Agents",
    description:
      "Several agents with round-robin OpenAI/Ollama turns, or delegate to Python AutoGen.",
    icon: "network",
  },
];
