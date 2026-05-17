import { Email, loadEmails } from "@/app/search";
import { tool } from "ai";
import { z } from "zod";

const SNIPPET_LENGTH = 150;

export type FilterToolResultItem = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string | string[];
  timestamp: string;
  snippet: string;
};

export const filterTool = tool({
  description: [
    "Retrieve emails by exact metadata: sender, recipient, body substring, or date range.",
    "Returns metadata with snippets only (id, threadId, subject, from, to, timestamp, snippet). Use `getEmailsTool` to fetch the full body of specific emails after reviewing the snippets.",
    "All provided filters are combined with AND; substring matches are case-insensitive.",
    "Use this when the user names concrete fields, for example 'emails from alice@acme.com last week' or 'messages to the legal team mentioning invoice'.",
    "Do NOT use this for open-ended or topical questions like 'what did we discuss about pricing?'. Use the search tool for those, since it ranks by relevance.",
    "Omit any filter you don't need rather than passing an empty string.",
  ].join(" "),
  inputSchema: z.object({
    from: z
      .string()
      .optional()
      .describe("Substring to match against the sender address"),
    to: z
      .string()
      .optional()
      .describe("Substring to match against any recipient address"),
    contains: z
      .string()
      .optional()
      .describe("Substring to match against the email body"),
    before: z.iso
      .datetime()
      .optional()
      .describe("ISO 8601 datetime; include emails on or before this instant"),
    after: z.iso
      .datetime()
      .optional()
      .describe("ISO 8601 datetime; include emails on or after this instant"),
    limit: z.number().default(10).describe("The limit of emails to return"),
  }),
  execute: async ({ from, to, contains, before, after, limit }) => {
    const emails = await loadEmails();
    let filteredEmails: Email[] = emails;

    if (from) {
      const lowerFrom = from.toLowerCase();
      filteredEmails = filteredEmails.filter((email) =>
        email.from.toLowerCase().includes(lowerFrom)
      );
    }
    if (to) {
      const lowerTo = to.toLowerCase();
      filteredEmails = filteredEmails.filter((email) =>
        Array.isArray(email.to)
          ? email.to.some((t) => t.toLowerCase().includes(lowerTo))
          : email.to.toLowerCase().includes(lowerTo)
      );
    }
    if (contains) {
      const lowerContains = contains.toLowerCase();
      filteredEmails = filteredEmails.filter((email) =>
        email.body.toLowerCase().includes(lowerContains)
      );
    }
    if (before) {
      const beforeDate = new Date(before);
      filteredEmails = filteredEmails.filter(
        (email) => new Date(email.timestamp) <= beforeDate
      );
    }
    if (after) {
      const afterDate = new Date(after);
      filteredEmails = filteredEmails.filter(
        (email) => new Date(email.timestamp) >= afterDate
      );
    }
    filteredEmails = filteredEmails.slice(0, limit);

    const results: FilterToolResultItem[] = filteredEmails.map((email) => {
      const trimmed = email.body.slice(0, SNIPPET_LENGTH).trim();
      const snippet =
        email.body.length > SNIPPET_LENGTH ? `${trimmed}...` : trimmed;

      return {
        id: email.id,
        threadId: email.threadId,
        subject: email.subject,
        from: email.from,
        to: email.to,
        timestamp: email.timestamp,
        snippet,
      };
    });

    return { emails: results };
  },
});
