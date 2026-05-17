import { loadEmails } from "@/app/search";
import { tool } from "ai";
import { z } from "zod";

export const getEmailsTool = tool({
  description: [
    "Fetch full email bodies by id.",
    "Call this after `searchTool` or `filterTool` once you have decided which specific emails you need to read end-to-end.",
    "Skip it when the snippets you already have are enough to answer the user.",
    "Set `includeThread` to true to also return every other email sharing the same thread, sorted by timestamp. Use this when context from earlier or later replies is needed to answer the user.",
  ].join(" "),
  inputSchema: z.object({
    ids: z
      .array(z.string())
      .min(1)
      .describe(
        "Email ids returned by `searchTool` or `filterTool` whose full body you need to read."
      ),
    includeThread: z
      .boolean()
      .default(false)
      .describe(
        "If true, also include every other email that shares a threadId with any requested id. Results are sorted by timestamp ascending."
      ),
  }),
  execute: async ({ ids, includeThread }) => {
    const allEmails = await loadEmails();
    const idSet = new Set(ids);
    const requested = allEmails.filter((email) => idSet.has(email.id));

    const selectedIds = new Set(requested.map((email) => email.id));
    if (includeThread) {
      const threadIds = new Set(
        requested.map((email) => email.threadId).filter(Boolean)
      );
      for (const email of allEmails) {
        if (threadIds.has(email.threadId)) {
          selectedIds.add(email.id);
        }
      }
    }

    const emails = allEmails
      .filter((email) => selectedIds.has(email.id))
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
      .map((email) => ({
        id: email.id,
        threadId: email.threadId,
        subject: email.subject,
        from: email.from,
        to: email.to,
        cc: email.cc,
        timestamp: email.timestamp,
        inReplyTo: email.inReplyTo,
        references: email.references,
        body: email.body,
      }));

    return { emails };
  },
});
