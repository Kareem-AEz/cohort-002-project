import { loadEmails, reciprocalRankFusion, searchWithBM25, searchWithEmbeddings } from "@/app/search";
import { tool } from "ai";
import z from "zod";

export const searchTool = tool({
    description: "Search emails using both keyword and semantic search. Returns most relevant emails ranked by reciprocal rank fusion.",
    inputSchema: z.object({
        keywords: z
            .array(z.string())
            .describe("Exact keywords for BM25 search (names, amounts, specific terms)")
            .optional(),
        searchQuery: z
            .string()
            .describe("Natural language query for semantic search (broader concepts)").optional(),
    }),
    execute: async ({ keywords, searchQuery}) => {
        console.log("Keywords:", keywords);
        console.log("Search query:", searchQuery);
        
        const emails = await loadEmails();
        
        // Use search algorithm from lesson 2.2
        const bm25Results = keywords ? await searchWithBM25(keywords, emails) : [];
        const embeddingResults = searchQuery ? await searchWithEmbeddings(searchQuery, emails) : [];
        const rrfResults = reciprocalRankFusion([
            bm25Results.slice(0, 30), // Only take the top 30 results from each search
            embeddingResults.slice(0, 30), // Only take the top 30 results from each search
        ]);

        // Sort the results by score
        const sortedResults = rrfResults.sort((a, b) => b.score - a.score);
        const topeEmails = sortedResults.slice(0, 10).map((result) => ({
            id: result.email.id,
            from: result.email.from,
            to: result.email.to,
            subject: result.email.subject,
            body: result.email.body,
            timestamp: result.email.timestamp,
            score: result.score,
        }));

        // Return the top 10 results
        return {
            emails: topeEmails,
        };
    }
});