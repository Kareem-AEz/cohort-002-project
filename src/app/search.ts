import BM25 from "okapibm25";
import fs from "fs/promises";
import path from "path";
import { embed, embedMany, cosineSimilarity, JSONValue } from "ai";
import {
  ensureEmbeddingsCacheDirectory,
  getCachedEmbedding,
  writeEmbeddingToCache,
} from "@/app/embeddings";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

export interface Email {
  id: string;
  threadId: string;
  from: string;
  to: string | string[];
  cc?: string[];
  subject: string;
  body: string;
  timestamp: string;
  inReplyTo?: string;
  references?: string[];
  labels?: string[];
  arcId?: string;
  phaseId?: number;
}

export interface EmailChunk {
  id: string;
  subject: string;
  chunk: string;
  index: number;
  totalChunks: number;
  from: string;
  to: string | string[];
  timestamp: string;
  [key: string]: JSONValue;
}

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 100,
  separators: ["\n\n", "\n", " ", ""],
});

export const emailChunkToText = (emailChunk: EmailChunk) =>
  `${emailChunk.subject} ${emailChunk.chunk}`;

export const emailToChunks = async (emails: Email[]): Promise<EmailChunk[]> => {
  const emailChunks: EmailChunk[] = [];

  for (const email of emails) {
    const chunks = await textSplitter.splitText(email.body);
    chunks.forEach((chunk, index) => {
      emailChunks.push({
        id: email.id,
        subject: email.subject,
        chunk,
        index,
        from: email.from,
        to: email.to,
        timestamp: email.timestamp,
        totalChunks: chunks.length,
      });
    });
  }
  return emailChunks;
};

export async function searchWithBM25<T>(
  keywords: string[],
  items: T[],
  itemToText: (item: T) => string
) {
  // Combine subject + body for richer text corpus
  const corpus = items.flatMap((item) => itemToText(item));

  // BM25 returns score array matching corpus order
  const scores: number[] = (BM25 as any)(corpus, keywords);

  // Map scores to emails, sort descending
  return scores
    .map((score, idx) => ({ score, item: items[idx] }))
    .sort((a, b) => b.score - a.score);
}

export async function loadEmails(): Promise<Email[]> {
  const filePath = path.join(process.cwd(), "data", "emails.json");
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}

export async function loadOrGenerateEmbeddings<T>(
  items: T[],
  itemToText: (item: T) => string
): Promise<{ item: T; embedding: number[] }[]> {
  // Ensure cache directory exists
  await ensureEmbeddingsCacheDirectory();

  const results: { item: T; embedding: number[] }[] = [];
  const uncachedItems: T[] = [];

  // Check cache for each email
  for (const item of items) {
    try {
      const cached = await getCachedEmbedding(itemToText(item));
      if (cached) {
        results.push({ item, embedding: cached });
      } else {
        // Cache miss - need to generate
        uncachedItems.push(item);
      }
    } catch {
      // Cache miss - need to generate
      uncachedItems.push(item);
    }
  }

  // Generate embeddings for uncached emails in batches of 99
  if (uncachedItems.length > 0) {
    console.log(`Generating embeddings for ${uncachedItems.length} items`);

    const BATCH_SIZE = 99;
    for (let i = 0; i < uncachedItems.length; i += BATCH_SIZE) {
      const batch = uncachedItems.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          uncachedItems.length / BATCH_SIZE
        )}`
      );

      const { embeddings } = await embedMany({
        model: "voyage/voyage-4-large",
        values: batch.map(itemToText),
      });

      // Write batch to cache
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const embedding = embeddings[j];

        await writeEmbeddingToCache(itemToText(item), embedding);
        results.push({ item, embedding });
      }
    }
  }

  return results;
}

export async function searchWithEmbeddings<T>(
  query: string,
  items: T[],
  itemToText: (item: T) => string
) {
  // No query = no semantic ranking; return all emails with zero score
  if (!query.trim()) {
    return items.map((item) => ({ score: 0, item }));
  }

  // Load cached embeddings
  const itemEmbeddings = await loadOrGenerateEmbeddings(items, itemToText);

  // Generate query embedding
  const { embedding: queryEmbedding } = await embed({
    model: "voyage/voyage-4-lite",
    value: query,
  });

  // Calculate similarity scores
  const results = itemEmbeddings.map(({ item, embedding }) => {
    const score = cosineSimilarity(queryEmbedding, embedding);
    return { score, item };
  });

  // Sort by similarity descending
  return results.sort((a, b) => b.score - a.score);
}

const RRF_K = 60;

export function reciprocalRankFusion<T>(
  rankings: { item: T; score: number }[][],
  toId: (item: T) => string
): { item: T; score: number }[] {
  const rrfScores = new Map<string, number>();
  const itemMap = new Map<string, T>();

  // Process each ranking list (BM25 and embeddings)
  rankings.forEach((ranking) => {
    ranking.forEach((item, rank) => {
      const currentScore = rrfScores.get(toId(item.item)) || 0;

      // Position-based scoring: 1/(k+rank)
      const contribution = 1 / (RRF_K + rank);
      rrfScores.set(toId(item.item), currentScore + contribution);

      itemMap.set(toId(item.item), item.item);
    });
  });

  // Sort by combined RRF score descending
  return Array.from(rrfScores.entries())
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .map(([toId, score]) => ({
      score,
      item: itemMap.get(toId)!,
    }));
}

export const searchWithRRF = async (
  query: string,
  emailChunks: EmailChunk[]
) => {
  const bm25Ranking = await searchWithBM25(
    query.toLowerCase().split(" "),
    emailChunks,
    emailChunkToText
  );
  const embeddingsRanking = await searchWithEmbeddings(
    query,
    emailChunks,
    emailChunkToText
  );
  const rrfRanking = reciprocalRankFusion(
    [bm25Ranking, embeddingsRanking],
    (item) => item.id
  );
  return rrfRanking;
};
