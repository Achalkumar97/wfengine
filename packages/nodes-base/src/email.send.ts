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

function mergeEmailPayload(
  c: z.infer<typeof EmailSendConfigSchema>,
  inputData: Record<string, unknown>,
): Omit<
  z.infer<typeof EmailSendConfigSchema>,
  "wfengineToolOnly"
> {
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
    typeof inputData.replyTo === "string"
      ? inputData.replyTo
      : base.replyTo;

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
    const parsed = z
      .array(EmailAttachmentSchema)
      .max(20)
      .safeParse(inputData.attachments);
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

  return {
    ...base,
    text,
    html,
    subject,
    to,
    replyTo,
    attachments,
  };
}

export const emailSendNode: NodeDefinition = {
  type: "email.send",
  label: "Send email",
  category: "action",
  description:
    "Send mail via SMTP using Nodemailer. Prefer app passwords for Gmail. Optional attachments; inputData can override text, subject, to, attachments for agent tool calls.",
  configSchema:
    EmailSendConfigSchema as unknown as z.ZodType<Record<string, unknown>>,
  outputSchema:
    EmailSendOutputSchema as unknown as z.ZodType<Record<string, unknown>>,
  execute: async ({ config, inputData, context }) => {
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

    const transporter = nodemailer.createTransport({
      host: merged.host,
      port: merged.port,
      secure: merged.secure,
      auth: { user: merged.authUser, pass: merged.authPass },
    });

    context.logger.info("Sending email", { to: merged.to, subject: merged.subject });

    const info = await transporter.sendMail({
      from: merged.from,
      to: merged.to,
      subject: merged.subject,
      text: merged.text,
      html: merged.html,
      replyTo: merged.replyTo,
      attachments:
        merged.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
        })) ?? undefined,
    });

    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    };
  },
};
