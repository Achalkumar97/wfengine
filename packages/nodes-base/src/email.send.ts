import type { NodeDefinition } from "@wfengine/core";
import nodemailer from "nodemailer";
import { z } from "zod";
import {
  EmailSendConfigSchema,
  EmailSendOutputSchema,
} from "./config-schemas.js";

export {
  EmailSendConfigSchema,
  EmailSendOutputSchema,
} from "./config-schemas.js";

export type EmailSendConfig = z.infer<typeof EmailSendConfigSchema>;

export const emailSendNode: NodeDefinition = {
  type: "email.send",
  label: "Send email",
  category: "action",
  description:
    "Send mail via SMTP using Nodemailer. Prefer app passwords for Gmail.",
  configSchema:
    EmailSendConfigSchema as unknown as z.ZodType<Record<string, unknown>>,
  outputSchema:
    EmailSendOutputSchema as unknown as z.ZodType<Record<string, unknown>>,
  execute: async ({ config, inputData, context }) => {
    const c = EmailSendConfigSchema.parse(config);
    if (!c.text && !c.html) {
      throw new Error("email.send requires config.text and/or config.html");
    }

    const transporter = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: { user: c.authUser, pass: c.authPass },
    });

    context.logger.info("Sending email", { to: c.to, subject: c.subject });

    const info = await transporter.sendMail({
      from: c.from,
      to: c.to,
      subject: c.subject,
      text: c.text,
      html: c.html,
      replyTo: c.replyTo,
    });

    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    };
  },
};
