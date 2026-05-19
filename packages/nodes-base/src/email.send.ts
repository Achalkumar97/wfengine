/**
 * email.send.ts
 *
 * Production-safe email sending via Nodemailer + Gmail App Password SMTP.
 * Designed for Railway / cloud container environments where:
 *   - IPv6 may cause DNS resolution to hang (fixed with dns.setDefaultResultOrder)
 *   - SMTP connections can silently stall (fixed with explicit timeouts)
 *   - transporter.verify() is SKIPPED — it hangs on Railway outbound SMTP
 *     and is not needed for production sending. sendMail() is attempted directly.
 *   - All failures are caught and returned as structured JSON — workflow never crashes
 *
 * Required environment variables:
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=you@gmail.com
 *   SMTP_PASS=<16-char Gmail App Password>
 *   SMTP_FROM=you@gmail.com   (optional — falls back to SMTP_USER)
 *
 * Phase-level timeout breakdown (what each timer covers):
 *   DNS resolution      — dns.promises.lookup() with 10s withTimeout()
 *   connectionTimeout   — TCP socket connect to SMTP server (30s, Nodemailer internal)
 *   greetingTimeout     — wait for "220 smtp.gmail.com" ESMTP banner (30s, Nodemailer internal)
 *   socketTimeout       — idle socket during DATA transfer (30s, Nodemailer internal)
 *   withTimeout(send)   — hard wall-clock cap on transporter.sendMail() (30s)
 *
 * NOTE: transporter.verify() is intentionally removed.
 *   verify() opens a separate TCP connection just to test credentials, then closes it.
 *   On Railway, this extra connection frequently times out even when sendMail() would
 *   succeed. Removing verify() means the first real connection attempt is sendMail()
 *   itself — if that fails, the error is caught and returned as structured JSON.
 *
 * Reading the logs to find the hang:
 *   Stops after "[EMAIL] resolving DNS"          → DNS phase hanging (IPv6 / ENOTFOUND)
 *   Stops after "[EMAIL] DNS resolved"           → TCP connect hanging (port blocked)
 *   Stops after "[EMAIL] before sendMail"        → sendMail DATA / socketTimeout
 */

import dns from "node:dns";
import type { NodeDefinition } from "@wfengine/core";
import nodemailer from "nodemailer";
import { z } from "zod";
import {
  EmailAttachmentSchema,
  EmailSendConfigSchema,
  EmailSendOutputSchema,
} from "./config-schemas.js";

export {
  EmailSendConfigSchema,
  EmailSendOutputSchema,
} from "./config-schemas.js";

export type EmailSendConfig = z.infer<typeof EmailSendConfigSchema>;

// ─── IPv4-first DNS — critical for Railway ───────────────────────────────────
// Railway containers often have IPv6 enabled but Gmail SMTP only reliably
// accepts IPv4. Without this, getaddrinfo may return an IPv6 address first,
// causing a silent connection hang that looks like a timeout.
dns.setDefaultResultOrder("ipv4first");

// ─── Timeout helper ──────────────────────────────────────────────────────────

/**
 * Race a promise against a hard timeout.
 * Clears the timer on both success and failure so no dangling handles remain.
 * Used around dns.lookup, transporter.verify(), and transporter.sendMail().
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    // Always clear — prevents the timer from keeping the process alive
    // and avoids a dangling rejection if the timeout fires after success.
    clearTimeout(timeoutId);
  }
}

// ─── Payload merge ───────────────────────────────────────────────────────────

function mergeEmailPayload(
  c: z.infer<typeof EmailSendConfigSchema>,
  inputData: Record<string, unknown>,
): Omit<z.infer<typeof EmailSendConfigSchema>, "wfengineToolOnly"> {
  const { wfengineToolOnly: _w, ...base } = c;

  const text =
    typeof inputData.text === "string"
      ? inputData.text
      : typeof inputData.output === "string" &&
          inputData.output.trim().length > 0
        ? inputData.output
        : base.text;

  const html =
    typeof inputData.html === "string" ? inputData.html : base.html;

  const subject =
    typeof inputData.subject === "string" ? inputData.subject : base.subject;

  const replyTo =
    typeof inputData.replyTo === "string" ? inputData.replyTo : base.replyTo;

  let to: z.infer<typeof EmailSendConfigSchema>["to"] = base.to;
  if (typeof inputData.to === "string" && inputData.to.trim().length > 0) {
    to = inputData.to;
  } else if (
    Array.isArray(inputData.to) &&
    inputData.to.length > 0 &&
    inputData.to.every((x) => typeof x === "string")
  ) {
    to = inputData.to as string[];
  }

  let attachments = base.attachments;
  if (Array.isArray(inputData.attachments)) {
    const parsed = z.array(EmailAttachmentSchema).max(20).safeParse(inputData.attachments);
    if (parsed.success) {
      attachments = parsed.data;
    }
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

  return { ...base, text, html, subject, to, replyTo, attachments };
}

// ─── Resolve SMTP config ─────────────────────────────────────────────────────

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * Resolve SMTP credentials with this priority:
 *   1. Node config fields (set in Studio)
 *   2. Environment variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM)
 *
 * This lets Railway env vars act as defaults while still allowing per-node overrides.
 */
function resolveSmtpConfig(
  merged: Omit<z.infer<typeof EmailSendConfigSchema>, "wfengineToolOnly">,
): SmtpConfig {
  const host =
    merged.host?.trim() ||
    process.env.SMTP_HOST?.trim() ||
    "";

  const port =
    merged.port ||
    Number(process.env.SMTP_PORT) ||
    587;

  const user =
    merged.authUser?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "";

  const pass =
    merged.authPass?.trim() ||
    process.env.SMTP_PASS?.trim() ||
    "";

  const from =
    merged.from?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "";

  return { host, port, user, pass, from };
}

// ─── Node definition ─────────────────────────────────────────────────────────

export const emailSendNode: NodeDefinition = {
  type: "email.send",
  label: "Send email",
  category: "action",
  description:
    "Send mail via SMTP using Nodemailer. Production-safe for Railway: IPv4-first DNS, explicit timeouts, SMTP verify before send. Use Gmail App Passwords (not account password). Optional attachments; inputData can override text, subject, to, attachments for agent tool calls.",
  configSchema:
    EmailSendConfigSchema as unknown as z.ZodType<Record<string, unknown>>,
  outputSchema:
    EmailSendOutputSchema as unknown as z.ZodType<Record<string, unknown>>,

  execute: async ({ config, inputData, context }) => {
    // ════════════════════════════════════════════════════════════════════════
    // [TOOL] send_client_email — outer tool wrapper timing
    // ════════════════════════════════════════════════════════════════════════
    console.log("[TOOL] send_client_email START");
    const toolStart = Date.now();

    // ── PHASE 0: Wall-clock start + env snapshot ──────────────────────────
    // These logs appear FIRST in Railway. If you see nothing after this,
    // the process crashed before reaching DNS.
    const started = Date.now();
    console.log("[EMAIL] ===== START =====");
    console.log("[EMAIL] timestamp", new Date().toISOString());
    console.log("[EMAIL] SMTP_HOST", process.env.SMTP_HOST);
    console.log("[EMAIL] SMTP_PORT", process.env.SMTP_PORT);
    console.log("[EMAIL] SMTP_USER exists", !!process.env.SMTP_USER);
    console.log("[EMAIL] SMTP_PASS exists", !!process.env.SMTP_PASS);
    context.logger.info("[EMAIL] ===== START =====", {
      executionId: context.executionId,
      workflowId: context.workflowId,
      timestamp: new Date().toISOString(),
      smtpHost: process.env.SMTP_HOST,
      smtpPort: process.env.SMTP_PORT,
      smtpUserExists: !!process.env.SMTP_USER,
      smtpPassExists: !!process.env.SMTP_PASS,
    });

    try {
      // ── Parse + merge config ──────────────────────────────────────────────
      const parsed = EmailSendConfigSchema.parse(config);
      const merged = mergeEmailPayload(parsed, inputData as Record<string, unknown>);

      if (
        (merged.text === undefined || merged.text.trim().length === 0) &&
        (merged.html === undefined || merged.html.trim().length === 0)
      ) {
        throw new Error(
          "email.send requires config.text and/or config.html (or pass text/html via inputData from a tool call)",
        );
      }

      // ── Resolve SMTP credentials ──────────────────────────────────────────
      const smtp = resolveSmtpConfig(merged);

      if (!smtp.host) {
        throw new Error(
          "email.send: SMTP host is not configured. Set config.host or SMTP_HOST env var.",
        );
      }
      if (!smtp.user) {
        throw new Error(
          "email.send: SMTP user is not configured. Set config.authUser or SMTP_USER env var.",
        );
      }
      if (!smtp.pass) {
        throw new Error(
          "email.send: SMTP password is not configured. Set config.authPass or SMTP_PASS env var. For Gmail use a 16-character App Password.",
        );
      }
      if (!smtp.from) {
        throw new Error(
          "email.send: Sender address is not configured. Set config.from or SMTP_FROM env var.",
        );
      }

      // ════════════════════════════════════════════════════════════════════
      // PHASE 1: DNS resolution
      // If the log stops HERE, the hang is in DNS:
      //   - IPv6 address returned (ipv4first is set but check Railway network)
      //   - SMTP_HOST is wrong / unresolvable
      //   - Railway DNS is broken
      // ════════════════════════════════════════════════════════════════════
      console.log("[EMAIL] resolving DNS");
      context.logger.info("[EMAIL] PHASE 1: DNS resolution", { host: smtp.host });

      const dnsStart = Date.now();
      let resolvedAddress: string;
      try {
        // dns.promises.lookup respects setDefaultResultOrder("ipv4first")
        const result = await withTimeout(
          dns.promises.lookup(smtp.host),
          10_000,
          `dns.lookup(${smtp.host})`,
        );
        resolvedAddress = result.address;
        const dnsDurationMs = Date.now() - dnsStart;
        console.log("[EMAIL] DNS resolved in", dnsDurationMs, "ms");
        console.log("[EMAIL] DNS address", resolvedAddress, "family", result.family);
        context.logger.info("[EMAIL] PHASE 1: DNS resolved", {
          host: smtp.host,
          address: resolvedAddress,
          family: result.family,
          durationMs: dnsDurationMs,
          // family=4 means IPv4 (correct), family=6 means IPv6 (may hang on Railway)
          ipVersionWarning: result.family === 6
            ? "WARNING: IPv6 address returned — may cause connection hang on Railway"
            : null,
        });
        if (result.family === 6) {
          console.warn(
            "[EMAIL] WARNING: IPv6 address returned for",
            smtp.host,
            "— this may cause a connection hang on Railway",
          );
        }
      } catch (dnsErr) {
        const dnsDurationMs = Date.now() - dnsStart;
        const message = dnsErr instanceof Error ? dnsErr.message : String(dnsErr);
        console.error("[EMAIL] DNS resolution FAILED", {
          host: smtp.host,
          durationMs: dnsDurationMs,
          error: message,
          // PHASE 1 failure — DNS is the hang point
          phase: "DNS",
        });
        context.logger.error("[EMAIL] PHASE 1: DNS FAILED", {
          host: smtp.host,
          durationMs: dnsDurationMs,
          error: message,
          diagnosis: diagnoseSMTPError(message, "verify"),
        });
        // Re-throw — caught by outer try/catch for structured return
        throw new Error(`[EMAIL] DNS resolution failed for ${smtp.host} after ${dnsDurationMs}ms: ${message}`);
      }

      // ════════════════════════════════════════════════════════════════════
      // PHASE 2: Transporter creation (synchronous — should be instant)
      // If the log stops HERE, there is a bug in Nodemailer config parsing.
      // ════════════════════════════════════════════════════════════════════
      console.log("[EMAIL] creating transporter");
      context.logger.info("[EMAIL] PHASE 2: creating transporter", {
        host: smtp.host,
        port: smtp.port,
        // secure=false → STARTTLS on port 587 (correct for Gmail App Password)
        // secure=true  → SSL/TLS on port 465
        secure: merged.secure,
        user: smtp.user,
        resolvedAddress,
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 30_000,
      });

      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: merged.secure, // false for port 587 (STARTTLS)
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
        // connectionTimeout: TCP socket connect to smtp.gmail.com:587
        // If this fires → port 587 is blocked or host unreachable
        connectionTimeout: 60_000,
        // greetingTimeout: wait for "220 smtp.gmail.com ESMTP" banner
        // If this fires → connected but server not responding (TLS mismatch, wrong port)
        greetingTimeout: 60_000,
        // socketTimeout: idle socket during DATA transfer
        // If this fires → message body too large or network congestion
        socketTimeout: 60_000,
      });

      console.log("[EMAIL] transporter created");
      context.logger.info("[EMAIL] PHASE 2: transporter created");

      // ════════════════════════════════════════════════════════════════════
      // PHASE 3: SMTP verify — REMOVED
      // transporter.verify() is intentionally skipped on Railway.
      // It opens a separate TCP connection just to test credentials, then
      // closes it. On Railway this extra connection frequently times out
      // (30s hang) even when sendMail() would succeed on the same host.
      // sendMail() is attempted directly — any connection/auth failure is
      // caught below and returned as structured JSON without crashing the
      // workflow engine.
      // ════════════════════════════════════════════════════════════════════

      // ════════════════════════════════════════════════════════════════════
      // PHASE 4: Build mail options
      // Synchronous — should be instant. If it hangs here, there is a
      // serialization issue with attachment content (circular reference, etc.)
      // ════════════════════════════════════════════════════════════════════
      const toAddresses = Array.isArray(merged.to)
        ? merged.to.join(", ")
        : merged.to;

      const mailOptions = {
        from: smtp.from,
        to: toAddresses,
        subject: merged.subject,
        text: merged.text,
        html: merged.html,
        replyTo: merged.replyTo,
        attachments:
          merged.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
          })) ?? undefined,
      };

      // Measure serialization time — large attachments can be slow
      const serializeStart = Date.now();
      const serializedSize = JSON.stringify(mailOptions).length;
      const serializeDurationMs = Date.now() - serializeStart;
      context.logger.info("[EMAIL] PHASE 4: mail options built", {
        from: smtp.from,
        to: toAddresses,
        subject: merged.subject,
        hasText: Boolean(merged.text),
        hasHtml: Boolean(merged.html),
        attachmentCount: merged.attachments?.length ?? 0,
        // serializedSize is a proxy for total payload size
        serializedSizeChars: serializedSize,
        serializeDurationMs,
        // Warn if payload is large — may cause socketTimeout during DATA phase
        payloadWarning: serializedSize > 500_000
          ? `Large payload (${serializedSize} chars) — may hit socketTimeout during DATA`
          : null,
      });

      // ════════════════════════════════════════════════════════════════════
      // PHASE 5: sendMail — DATA transfer
      // If the log stops after "[EMAIL] before sendMail", the hang is in:
      //   - DATA phase (message body transfer)
      //   - socketTimeout (idle socket during large attachment upload)
      //   - Server-side processing delay after DATA
      // ════════════════════════════════════════════════════════════════════
      console.log("[EMAIL] before sendMail");
      context.logger.info("[EMAIL] PHASE 5: before sendMail", {
        from: smtp.from,
        to: toAddresses,
        subject: merged.subject,
        serializedSizeChars: serializedSize,
      });

      // Abort check — if user pressed Stop before SMTP DATA phase, skip send.
      if (context.signal?.aborted) {
        context.logger.info("[EMAIL] PHASE 5: skipped — execution was cancelled");
        throw new DOMException("Aborted", "AbortError");
      }

      const sendStart = Date.now();
      let info: Awaited<ReturnType<typeof transporter.sendMail>>;

      try {
        info = await withTimeout(
          transporter.sendMail(mailOptions),
          60_000,
          "sendMail",
        );
      } catch (sendErr) {
        const sendDurationMs = Date.now() - sendStart;
        const message = sendErr instanceof Error ? sendErr.message : String(sendErr);
        const stack = sendErr instanceof Error ? sendErr.stack : undefined;
        const diagnosis = diagnoseSMTPError(message, "sendMail");

        console.error("[EMAIL] sendMail FAILED");
        console.error({
          message,
          stack,
          timestamp: new Date().toISOString(),
          durationMs: sendDurationMs,
          // PHASE 5 failure
          phase: "SEND_MAIL",
          diagnosis,
        });
        context.logger.error("[EMAIL] PHASE 5: sendMail FAILED", {
          durationMs: sendDurationMs,
          totalDurationMs: Date.now() - started,
          error: message,
          diagnosis,
        });

        throw new Error(
          `[EMAIL] sendMail failed after ${sendDurationMs}ms: ${message}\n` +
          `Diagnosis: ${diagnosis}`,
        );
      }

      const sendDurationMs = Date.now() - sendStart;
      console.log("[EMAIL] sendMail completed in", sendDurationMs, "ms");
      console.log("[EMAIL] messageId", info.messageId);

      // ════════════════════════════════════════════════════════════════════
      // PHASE 6: Result serialization
      // Synchronous — should be instant. Logged separately so we can confirm
      // the tool return value was built without error.
      // ════════════════════════════════════════════════════════════════════
      const totalDurationMs = Date.now() - started;
      console.log("[EMAIL] TOTAL COMPLETED IN", totalDurationMs, "ms");
      console.log("[EMAIL] ===== END =====");

      context.logger.info("[EMAIL] PHASE 6: completed", {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
        sendDurationMs,
        totalDurationMs,
      });

      // Structured success return — never hangs, always serializable
      const result = {
        success: true,
        messageId: info.messageId,
        accepted: (info.accepted ?? []) as string[],
        rejected: (info.rejected ?? []) as string[],
        response: info.response,
        durationMs: totalDurationMs,
      };

      console.log("[TOOL] send_client_email END", Date.now() - toolStart, "ms");
      return result;

    } catch (error) {
      // ════════════════════════════════════════════════════════════════════
      // CATCH-ALL: structured error log + structured error return
      // The phase-specific logs above already fired before this point,
      // so you can correlate the last phase log with this error.
      // ════════════════════════════════════════════════════════════════════
      console.error("[EMAIL] ERROR");
      console.error({
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
      });

      context.logger.error("[EMAIL] execution failed", {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });

      console.log("[TOOL] send_client_email END (error)", Date.now() - toolStart, "ms");

      // Structured error return — the workflow engine receives this as the
      // node output rather than an unhandled exception crashing the worker.
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        accepted: [] as string[],
        rejected: [] as string[],
        durationMs: Date.now() - started,
      };
    }
  },
};

// ─── Diagnosis helper ─────────────────────────────────────────────────────────

/**
 * Map common SMTP error messages to actionable diagnoses.
 * Helps identify exactly where the timeout/failure occurred.
 */
function diagnoseSMTPError(message: string, phase: "verify" | "sendMail"): string {
  const m = message.toLowerCase();

  if (m.includes("timeout") && phase === "verify") {
    return (
      "Timeout during SMTP verify. Likely causes: " +
      "(1) DNS resolved an IPv6 address — dns.setDefaultResultOrder('ipv4first') is set but check Railway network config; " +
      "(2) TCP port 587 is blocked by Railway firewall — check outbound port rules; " +
      "(3) SMTP_HOST is wrong or unreachable from this container."
    );
  }

  if (m.includes("timeout") && phase === "sendMail") {
    return (
      "Timeout during sendMail DATA phase. Likely causes: " +
      "(1) Message body too large — check attachment sizes; " +
      "(2) SMTP server accepted connection but stalled during DATA transfer; " +
      "(3) socketTimeout (30s) exceeded — network congestion or Railway egress throttling."
    );
  }

  if (m.includes("econnrefused")) {
    return (
      `Connection refused on ${phase}. ` +
      "SMTP_HOST:SMTP_PORT is not accepting connections. " +
      "Verify SMTP_HOST=smtp.gmail.com and SMTP_PORT=587."
    );
  }

  if (m.includes("enotfound") || m.includes("getaddrinfo")) {
    return (
      `DNS lookup failed on ${phase}. ` +
      "SMTP_HOST cannot be resolved. " +
      "Check SMTP_HOST value and Railway DNS configuration."
    );
  }

  if (m.includes("etimedout") || m.includes("connect etimedout")) {
    return (
      `TCP connect timed out on ${phase}. ` +
      "The host is reachable but not responding on port 587. " +
      "Railway may be blocking outbound port 587 — check egress firewall rules."
    );
  }

  if (m.includes("535") || m.includes("authentication") || m.includes("invalid credentials")) {
    return (
      `Authentication failed on ${phase}. ` +
      "For Gmail: use a 16-character App Password (not your account password). " +
      "Enable 2FA on the Google account, then generate an App Password at myaccount.google.com/apppasswords."
    );
  }

  if (m.includes("534") || m.includes("less secure")) {
    return (
      `Gmail rejected login on ${phase}. ` +
      "Gmail no longer allows 'less secure app' access. " +
      "Use a Gmail App Password with 2FA enabled."
    );
  }

  if (m.includes("550") || m.includes("relay")) {
    return (
      `Relay denied on ${phase}. ` +
      "The SMTP server rejected the recipient address. " +
      "Verify the 'to' address and that SMTP_USER is authorised to send."
    );
  }

  if (m.includes("certificate") || m.includes("tls") || m.includes("ssl")) {
    return (
      `TLS/SSL error on ${phase}. ` +
      "For port 587 set secure=false (STARTTLS). " +
      "For port 465 set secure=true (SSL). " +
      "Current config uses secure=" + (phase === "verify" ? "check node config" : "see node config") + "."
    );
  }

  if (m.includes("greeting")) {
    return (
      `SMTP greeting timeout on ${phase}. ` +
      "Connected to the server but did not receive the '220' banner within 30s. " +
      "Possible causes: wrong port, TLS mismatch, or server overloaded."
    );
  }

  return `Unknown SMTP error during ${phase}. See full error message and stack trace above.`;
}
