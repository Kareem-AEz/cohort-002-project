import { reranker } from "@/app/rerank";
import {
  EmailChunk,
  emailToChunks,
  loadEmails,
  reciprocalRankFusion,
  searchWithBM25,
  searchWithEmbeddings,
} from "@/app/search";
import { tool } from "ai";
import z from "zod";

export type SearchToolResultItem = EmailChunk & { score: number };

export const searchTool = tool({
  description: [
    "Rank emails by relevance using keyword (BM25) and semantic (embedding) search, fused with reciprocal rank fusion and reranked when a natural language query is provided.",
    "Returns the top 10 matching email chunks (excerpts, not whole emails).",
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
      ? await searchWithBM25(keywords, emailChunks)
      : [];
    const embeddingResults = searchQuery
      ? await searchWithEmbeddings(searchQuery, emailChunks)
      : [];
    const rrfResults = reciprocalRankFusion([
      bm25Results.slice(0, 30), // Only take the top 30 results from each search
      embeddingResults.slice(0, 30), // Only take the top 30 results from each search
    ]);

    // Sort the results by score
    const sortedResults = rrfResults.sort((a, b) => b.score - a.score);
    const topEmailChunks: SearchToolResultItem[] = sortedResults
      .slice(0, 30)
      .map((result) => ({ ...result.emailChunk, score: result.score }));

    let rerankedEmailChunks: EmailChunk[] = [];
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

    // Return the top 10 results
    return { emailChunks: rerankedEmailChunks };
  },
});
