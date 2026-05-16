import { EmailChunk, emailChunkToText } from "./search";
import { rerank } from "ai";

export const reranker = async (query: string, emailChunks: EmailChunk[]) => {
  const { rerankedDocuments, ranking } = await rerank({
    documents: emailChunks,
    query,
    model: "voyage/rerank-2.5-lite",
    topN: 10,
  });

  return rerankedDocuments;
};
