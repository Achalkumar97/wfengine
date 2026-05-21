import dns from "node:dns";
import type { NodeDefinition, WorkflowLogger } from "@wfengine/core";
import nodemailer from "nodemailer";
import { Resend, type CreateEmailOptions } from "resend";
import { z } from "zod";
import {
  EmailAttachmentSchema,
  EmailSendConfigSchema,
  EmailSendOutputSchema,
} from "./config-schemas.js";
import { interpolateTemplateTwice } from "./template-interpolate.js";

export {
  EmailSendConfigSchema,
  EmailSendOutputSchema,
} from "./config-schemas.js";

export type EmailSendConfig = z.infer<typeof EmailSendConfigSchema>;

type DeliveryMode = "smtp" | "resend";
type EmailAttachment = z.infer<typeof EmailAttachmentSchema>;
type EmailPayload = Omit<EmailSendConfig, "wfengineToolOnly"> & {
  deliveryMode: DeliveryMode;
};

type EmailProviderResult = {
  success: true;
  messageId?: string;
  accepted: string[];
  rejected: string[];
  response?: string;
  durationMs: number;
  deliveryMode: DeliveryMode;
};

type EmailProvider = {
  readonly mode: DeliveryMode;
  send(payload: EmailPayload): Promise<EmailProviderResult>;
};

const SMTP_DNS_TIMEOUT_MS = 10_000;
const SMTP_SEND_TIMEOUT_MS = 60_000;
const RESEND_SEND_TIMEOUT_MS = 30_000;

// Railway containers can prefer IPv6 for DNS answers; Gmail SMTP is often more
// reliable from containers when Node prefers IPv4.
dns.setDefaultResultOrder("ipv4first");

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    if (signal) {
      abortHandler = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

function coalesceString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function addressList(value: string | string[]): string[] {
  return Array.isArray(value)
    ? value.map((x) => x.trim()).filter(Boolean)
    : value.split(",").map((x) => x.trim()).filter(Boolean);
}

function payloadSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function interpolateMaybe(value: string | undefined, data: Record<string, unknown>): string | undefined {
  if (value === undefined) return undefined;
  return interpolateTemplateTwice(value, data);
}

function interpolateAddress(
  value: string | string[] | undefined,
  data: Record<string, unknown>,
): string | string[] | undefined {
  if (typeof value === "string") return interpolateTemplateTwice(value, data);
  if (Array.isArray(value)) return value.map((item) => interpolateTemplateTwice(item, data));
  return value;
}

function mergeEmailPayload(
  c: EmailSendConfig,
  inputData: Record<string, unknown>,
): EmailPayload {
  const { wfengineToolOnly: _w, ...base } = c;

  const text =
    coalesceString(inputData.text, inputData.message, inputData.body, inputData.content) ??
    (typeof inputData.output === "string" && inputData.output.trim().length > 0
      ? inputData.output
      : base.text);
  const html = coalesceString(inputData.html, inputData.htmlBody) ?? base.html;
  const subject =
    coalesceString(inputData.subject, inputData.title, inputData.topic, inputData.emailSubject) ??
    base.subject;
  const replyTo = coalesceString(inputData.replyTo, inputData.reply_to) ?? base.replyTo;

  const emailToCandidate =
    inputData.to ??
    inputData.recipients ??
    inputData.recipient ??
    inputData.emailRecipients ??
    inputData.emailTo ??
    inputData.addresses ??
    inputData.email ??
    inputData.recipientAddress ??
    inputData.toAddress ??
    inputData.toAddresses;

  let to: EmailSendConfig["to"] = base.to;
  if (typeof emailToCandidate === "string" && emailToCandidate.trim().length > 0) {
    to = emailToCandidate.trim();
  } else if (
    Array.isArray(emailToCandidate) &&
    emailToCandidate.length > 0 &&
    emailToCandidate.every((x) => typeof x === "string" && x.trim().length > 0)
  ) {
    to = emailToCandidate.map((x) => x.trim());
  }

  let attachments = base.attachments;
  if (Array.isArray(inputData.attachments)) {
    const parsed = z.array(EmailAttachmentSchema).max(20).safeParse(inputData.attachments);
    if (parsed.success) attachments = parsed.data;
  } else if (
    (!attachments || attachments.length === 0) &&
    typeof inputData.content === "string" &&
    inputData.content.length > 0 &&
    typeof base.attachInputContentAsFilename === "string" &&
    base.attachInputContentAsFilename.trim().length > 0
  ) {
    attachments = [
      {
        filename: base.attachInputContentAsFilename.trim(),
        content: inputData.content,
      },
    ];
  }

  const deliveryMode: DeliveryMode = base.deliveryMode === "resend" ? "resend" : "smtp";
  return {
    ...base,
    deliveryMode,
    from: interpolateMaybe(base.from, inputData),
    to: interpolateAddress(to, inputData) as EmailSendConfig["to"],
    subject: interpolateMaybe(subject, inputData) ?? subject,
    text: interpolateMaybe(text, inputData),
    html: interpolateMaybe(html, inputData),
    replyTo: interpolateMaybe(replyTo, inputData),
    attachments: attachments?.map((a) => ({
      filename: interpolateTemplateTwice(a.filename, inputData),
      content: interpolateTemplateTwice(a.content, inputData),
    })),
  };
}

function validateCommonPayload(payload: EmailPayload): void {
  if (addressList(payload.to).length === 0) {
    throw new Error("email.send: at least one recipient is required.");
  }
  if (!payload.subject?.trim()) {
    throw new Error("email.send: subject is required.");
  }
  if (!payload.text?.trim() && !payload.html?.trim()) {
    throw new Error(
      "email.send requires text and/or html (config value or tool/inputData payload).",
    );
  }
}

function resolveSmtpConfig(payload: EmailPayload) {
  return {
    host: payload.host?.trim() || process.env.SMTP_HOST?.trim() || "",
    port: payload.port || Number(process.env.SMTP_PORT) || 587,
    user: payload.authUser?.trim() || process.env.SMTP_USER?.trim() || "",
    pass: payload.authPass?.trim() || process.env.SMTP_PASS?.trim() || "",
    from:
      payload.from?.trim() ||
      process.env.SMTP_FROM?.trim() ||
      process.env.SMTP_USER?.trim() ||
      "",
  };
}

function validateSmtp(payload: EmailPayload): ReturnType<typeof resolveSmtpConfig> {
  const smtp = resolveSmtpConfig(payload);
  if (!smtp.host) throw new Error("email.send: SMTP host is required. Set host or SMTP_HOST.");
  if (!smtp.user) throw new Error("email.send: SMTP username is required. Set authUser or SMTP_USER.");
  if (!smtp.pass) throw new Error("email.send: SMTP password is required. Set authPass or SMTP_PASS.");
  if (!smtp.from) throw new Error("email.send: sender is required. Set from, SMTP_FROM, or SMTP_USER.");
  return smtp;
}

function resolveResendConfig(payload: EmailPayload) {
  return {
    apiKey: payload.resendApiKey?.trim() || process.env.RESEND_API_KEY?.trim() || "",
    from: payload.from?.trim() || process.env.RESEND_FROM?.trim() || process.env.EMAIL_FROM?.trim() || "",
  };
}

function validateResend(payload: EmailPayload): ReturnType<typeof resolveResendConfig> {
  const resend = resolveResendConfig(payload);
  if (!resend.apiKey) {
    throw new Error("email.send: Resend API key is required. Set resendApiKey or RESEND_API_KEY.");
  }
  if (!resend.from) {
    throw new Error("email.send: Resend sender is required. Set from, RESEND_FROM, or EMAIL_FROM.");
  }
  return resend;
}

function createSmtpProvider(opts: {
  logger: WorkflowLogger;
  signal?: AbortSignal;
}): EmailProvider {
  return {
    mode: "smtp",
    async send(payload) {
      const started = Date.now();
      opts.logger.info("[EMAIL][SMTP][VALIDATION] validating SMTP config");
      const smtp = validateSmtp(payload);

      opts.logger.info("[EMAIL][SMTP][DNS] resolving SMTP host", { host: smtp.host });
      const dnsStart = Date.now();
      const resolved = await withTimeout(
        dns.promises.lookup(smtp.host),
        SMTP_DNS_TIMEOUT_MS,
        `dns.lookup(${smtp.host})`,
        opts.signal,
      );
      opts.logger.info("[EMAIL][SMTP][DNS] resolved", {
        host: smtp.host,
        family: resolved.family,
        durationMs: Date.now() - dnsStart,
        railwayWarning:
          resolved.family === 6 ? "IPv6 result may stall on Railway SMTP egress." : null,
      });

      opts.logger.info("[EMAIL][SMTP][INIT] creating nodemailer transport", {
        host: smtp.host,
        port: smtp.port,
        secure: payload.secure,
        connectionTimeoutMs: SMTP_SEND_TIMEOUT_MS,
        greetingTimeoutMs: SMTP_SEND_TIMEOUT_MS,
        socketTimeoutMs: SMTP_SEND_TIMEOUT_MS,
      });
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: payload.secure,
        auth: { user: smtp.user, pass: smtp.pass },
        connectionTimeout: SMTP_SEND_TIMEOUT_MS,
        greetingTimeout: SMTP_SEND_TIMEOUT_MS,
        socketTimeout: SMTP_SEND_TIMEOUT_MS,
      });

      const mailOptions = {
        from: smtp.from,
        to: addressList(payload.to).join(", "),
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        replyTo: payload.replyTo,
        attachments: payload.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
        })),
      };
      const size = payloadSize(mailOptions);
      opts.logger.info("[EMAIL][SMTP][PAYLOAD_BUILD] mail options built", {
        toCount: addressList(payload.to).length,
        hasText: Boolean(payload.text),
        hasHtml: Boolean(payload.html),
        attachmentCount: payload.attachments?.length ?? 0,
        payloadSizeChars: size,
        payloadWarning: size > 500_000 ? "Large SMTP payload may stall during DATA phase." : null,
      });

      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const sendStart = Date.now();
      opts.logger.info("[EMAIL][SMTP][API_SEND] before nodemailer sendMail", {
        payloadSizeChars: size,
      });
      const info = await withTimeout(
        transporter.sendMail(mailOptions),
        SMTP_SEND_TIMEOUT_MS,
        "smtp.sendMail",
        opts.signal,
      );
      const durationMs = Date.now() - started;
      opts.logger.info("[EMAIL][SMTP][SUCCESS] sendMail completed", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
        sendDurationMs: Date.now() - sendStart,
        durationMs,
      });

      return {
        success: true,
        deliveryMode: "smtp",
        messageId: info.messageId,
        accepted: (info.accepted ?? []) as string[],
        rejected: (info.rejected ?? []) as string[],
        response: info.response,
        durationMs,
      };
    },
  };
}

function createResendProvider(opts: {
  logger: WorkflowLogger;
  signal?: AbortSignal;
}): EmailProvider {
  return {
    mode: "resend",
    async send(payload) {
      const started = Date.now();
      opts.logger.info("[EMAIL][RESEND][VALIDATION] validating Resend config");
      const resolved = validateResend(payload);

      opts.logger.info("[EMAIL][RESEND][INIT] creating Resend client", {
        hasApiKey: Boolean(resolved.apiKey),
      });
      const client = new Resend(resolved.apiKey);
      const to = addressList(payload.to);
      const request: CreateEmailOptions = {
        from: resolved.from,
        to,
        subject: payload.subject,
        ...(payload.html?.trim()
          ? { html: payload.html }
          : { text: payload.text ?? "" }),
        ...(payload.text?.trim() && payload.html?.trim()
          ? { text: payload.text }
          : {}),
        ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
        ...(payload.attachments?.length
          ? {
              attachments: payload.attachments.map((a: EmailAttachment) => ({
                filename: a.filename,
                content: Buffer.from(a.content, "utf8"),
              })),
            }
          : {}),
      };
      const size = payloadSize({
        ...request,
        attachments: request.attachments?.map((a) => ({
          filename: a.filename,
          bytes:
            typeof a.content === "string"
              ? Buffer.byteLength(a.content)
              : a.content?.byteLength ?? 0,
        })),
      });
      opts.logger.info("[EMAIL][RESEND][PAYLOAD_BUILD] API payload built", {
        toCount: to.length,
        hasText: Boolean(payload.text),
        hasHtml: Boolean(payload.html),
        attachmentCount: payload.attachments?.length ?? 0,
        payloadSizeChars: size,
      });

      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const sendStart = Date.now();
      opts.logger.info("[EMAIL][RESEND][API_SEND] before HTTPS API send", {
        timeoutMs: RESEND_SEND_TIMEOUT_MS,
      });
      const response = await withTimeout(
        client.emails.send(request),
        RESEND_SEND_TIMEOUT_MS,
        "resend.emails.send",
        opts.signal,
      );

      if (response.error) {
        throw new Error(
          `Resend API error: ${response.error.name ?? "error"} ${response.error.message}`,
        );
      }

      const durationMs = Date.now() - started;
      opts.logger.info("[EMAIL][RESEND][SUCCESS] API send completed", {
        messageId: response.data?.id,
        sendDurationMs: Date.now() - sendStart,
        durationMs,
        responseStatus: "accepted",
      });
      return {
        success: true,
        deliveryMode: "resend",
        messageId: response.data?.id,
        accepted: to,
        rejected: [],
        response: "accepted",
        durationMs,
      };
    },
  };
}

export function createEmailProvider(opts: {
  deliveryMode: DeliveryMode;
  logger: WorkflowLogger;
  signal?: AbortSignal;
}): EmailProvider {
  if (opts.deliveryMode === "resend") return createResendProvider(opts);
  return createSmtpProvider(opts);
}

export const emailSendNode: NodeDefinition = {
  type: "email.send",
  label: "Send email",
  category: "action",
  description:
    "Send email via SMTP or Resend. SMTP is the default for old workflows; Resend uses HTTPS and is recommended for Railway deployments.",
  configSchema:
    EmailSendConfigSchema as unknown as z.ZodType<Record<string, unknown>>,
  outputSchema:
    EmailSendOutputSchema as unknown as z.ZodType<Record<string, unknown>>,

  execute: async ({ config, inputData, context }) => {
    const started = Date.now();
    const parsed = EmailSendConfigSchema.parse(config);
    const merged = mergeEmailPayload(parsed, inputData as Record<string, unknown>);
    const provider = createEmailProvider({
      deliveryMode: merged.deliveryMode,
      logger: context.logger,
      signal: context.signal,
    });

    context.logger.info("[EMAIL][INIT] provider selected", {
      deliveryMode: provider.mode,
      executionId: context.executionId,
      workflowId: context.workflowId,
      hasSmtpEnv: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
      hasResendEnv: Boolean(process.env.RESEND_API_KEY),
    });

    try {
      validateCommonPayload(merged);
      const result = await provider.send(merged);
      EmailSendOutputSchema.parse(result);
      return result;
    } catch (error) {
      if (
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error("[EMAIL][FAILURE] execution failed", {
        deliveryMode: provider.mode,
        durationMs: Date.now() - started,
        error: message,
      });
      return {
        success: false,
        deliveryMode: provider.mode,
        error: message,
        accepted: [] as string[],
        rejected: [] as string[],
        durationMs: Date.now() - started,
      };
    }
  },
};
