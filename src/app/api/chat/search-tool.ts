import { reranker } from "@/app/rerank";
import {
  EmailChunk,
  emailChunkToText,
  emailToChunks,
  loadEmails,
  reciprocalRankFusion,
  searchWithBM25,
  searchWithEmbeddings,
} from "@/app/search";
import { tool } from "ai";
import z from "zod";

const SNIPPET_LENGTH = 150;

export type SearchToolResultItem = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string | string[];
  timestamp: string;
  score: number;
  snippet: string;
};

export const searchTool = tool({
  description: [
    "Rank emails by relevance using keyword (BM25) and semantic (embedding) search, fused with reciprocal rank fusion and reranked when a natural language query is provided.",
    "Returns metadata with snippets only (id, threadId, subject, from, to, timestamp, score, snippet). Use `getEmailsTool` to fetch the full body of specific emails after reviewing the snippets.",
    "Use this for topical or open-ended questions, like 'what did we decide about pricing?' or 'any updates on the Q3 launch?'.",
    "Do NOT use this when the user names exact metadata such as sender, recipient, or a date range. Use the filter tool for those.",
    "Provide `keywords` for terms expected to appear verbatim (names, amounts, IDs) and `searchQuery` for conceptual matches. You can pass both or just one, but at least one is required.",
  ].join(" "),
  inputSchema: z
    .object({
      keywords: z
        .array(z.string())
        .describe(
          "Terms expected to appear verbatim in matching emails, for example names, amounts, or product codes. Used for BM25 ranking."
        )
        .optional(),
      searchQuery: z
        .string()
        .describe(
          "Natural language description of what the user wants conceptually. Used for embedding-based ranking and reranking."
        )
        .optional(),
    })
    .refine((data) => data.keywords?.length || data.searchQuery, {
      error: "Provide keywords, searchQuery, or both.",
    }),
  execute: async ({ keywords, searchQuery }) => {
    console.log("Keywords:", keywords);
    console.log("Search query:", searchQuery);

    const allEmails = await loadEmails();
    const emailChunks = await emailToChunks(allEmails);

    // Use search algorithm from lesson 2.2
    const bm25Results = keywords
      ? await searchWithBM25(keywords, emailChunks, emailChunkToText)
      : [];
    const embeddingResults = searchQuery
      ? await searchWithEmbeddings(searchQuery, emailChunks, emailChunkToText)
      : [];
    const rrfResults = reciprocalRankFusion(
      [
        bm25Results.slice(0, 30), // Only take the top 30 results from each search
        embeddingResults.slice(0, 30), // Only take the top 30 results from each search
      ],
      (item) => item.id
    );

    // Sort the results by score
    const sortedResults = rrfResults.sort((a, b) => b.score - a.score);
    const topEmailChunks = sortedResults.slice(0, 30).map((result) => ({
      ...result.item,
      score: result.score,
    }));
    const scoreById = new Map(topEmailChunks.map((c) => [c.id, c.score]));

    let rerankedEmailChunks: EmailChunk[];
    if (searchQuery) {
      rerankedEmailChunks = (await reranker(searchQuery, topEmailChunks)).slice(
        0,
        10
      );
      console.log(
        "Reranked email chunks:",
        rerankedEmailChunks.map((chunk) => chunk.subject)
      );
    } else {
      rerankedEmailChunks = topEmailChunks.slice(0, 10);
    }

    const emailsById = new Map(allEmails.map((email) => [email.id, email]));

    const emailChunkResults: SearchToolResultItem[] = rerankedEmailChunks.map(
      (chunk) => {
        const trimmed = chunk.chunk.slice(0, SNIPPET_LENGTH).trim();
        const snippet =
          chunk.chunk.length > SNIPPET_LENGTH ? `${trimmed}...` : trimmed;

        return {
          id: chunk.id,
          threadId: emailsById.get(chunk.id)?.threadId ?? "",
          subject: chunk.subject,
          from: chunk.from,
          to: chunk.to,
          timestamp: chunk.timestamp,
          score: scoreById.get(chunk.id) ?? 0,
          snippet,
        };
      }
    );

    return { emailChunks: emailChunkResults };
  },
});
