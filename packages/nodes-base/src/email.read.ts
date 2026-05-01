import type { NodeDefinition } from "@wfengine/core";
import { ImapFlow } from "imapflow";
import { z } from "zod";
import {
  EmailReadConfigSchema,
  EmailReadMessageSchema,
  EmailReadOutputSchema,
} from "./config-schemas.js";

export {
  EmailReadConfigSchema,
  EmailReadMessageSchema,
  EmailReadOutputSchema,
} from "./config-schemas.js";

export type EmailReadConfig = z.infer<typeof EmailReadConfigSchema>;

export const emailReadNode: NodeDefinition = {
  type: "email.read",
  label: "Read email (IMAP)",
  category: "action",
  description:
    "Fetch messages over IMAP (ImapFlow). For Gmail: enable IMAP, use an app password, host imap.gmail.com:993.",
  configSchema:
    EmailReadConfigSchema as unknown as z.ZodType<Record<string, unknown>>,
  outputSchema:
    EmailReadOutputSchema as unknown as z.ZodType<Record<string, unknown>>,
  execute: async ({ config, inputData, context }) => {
    const c = EmailReadConfigSchema.parse(config);

    const client = new ImapFlow({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: { user: c.user, pass: c.password },
      logger: false,
    });

    const messages: z.infer<typeof EmailReadMessageSchema>[] = [];

    try {
      await client.connect();
      await client.mailboxOpen(c.mailbox);

      const searchQuery = c.unseenOnly ? { unseen: true } : { all: true };
      const rawUids = await client.search(searchQuery, { uid: true });
      const uidList = Array.isArray(rawUids) ? rawUids : [];
      const sorted = [...uidList].sort((a, b) => b - a);
      const take = sorted.slice(0, c.maxMessages);

      for (const uid of take) {
        const msg = await client.fetchOne(uid, {
          uid: true,
          envelope: true,
          flags: true,
          source: true,
        });
        if (!msg || !("source" in msg) || !msg.source) continue;

        const env = msg.envelope;
        const fromAddr = env?.from?.[0];
        const from =
          fromAddr && "address" in fromAddr && fromAddr.address
            ? String(fromAddr.address)
            : fromAddr && "name" in fromAddr && fromAddr.name
              ? String(fromAddr.name)
              : undefined;

        const subject = env?.subject ? String(env.subject) : "";
        const date =
          env?.date instanceof Date
            ? env.date.toISOString()
            : env?.date
              ? String(env.date)
              : undefined;

        const raw = msg.source.toString("utf8");
        const rough = raw.slice(0, c.previewChars);
        const textPreview =
          rough.length >= c.previewChars ? `${rough.slice(0, c.previewChars)}…` : rough;

        const seen =
          msg.flags instanceof Set ? msg.flags.has("\\Seen") : false;

        messages.push({
          uid: Number(msg.uid),
          subject,
          from,
          date,
          seen,
          textPreview,
        });
      }
    } finally {
      context.logger.info("IMAP logout");
      await client.logout().catch(() => undefined);
    }

    return {
      mailbox: c.mailbox,
      count: messages.length,
      messages,
    };
  },
};
