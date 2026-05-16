import BM25 from "okapibm25";
import fs from "fs/promises";
import path from "path";
import { embed, embedMany, cosineSimilarity } from "ai";
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

export async function searchWithBM25(
  keywords: string[],
  emailChunks: EmailChunk[]
) {
  // Combine subject + body for richer text corpus
  const corpus = emailChunks.map(emailChunkToText);

  // BM25 returns score array matching corpus order
  const scores: number[] = (BM25 as any)(corpus, keywords);

  // Map scores to emails, sort descending
  return scores
    .map((score, idx) => ({ score, emailChunk: emailChunks[idx] }))
    .sort((a, b) => b.score - a.score);
}

export async function loadEmails(): Promise<Email[]> {
  const filePath = path.join(process.cwd(), "data", "emails.json");
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}

export async function loadOrGenerateEmbeddings(
  emailChunks: EmailChunk[]
): Promise<{ id: string; embedding: number[] }[]> {
  // Ensure cache directory exists
  await ensureEmbeddingsCacheDirectory();

  const results: { id: string; embedding: number[] }[] = [];
  const uncachedEmailChunks: EmailChunk[] = [];

  // Check cache for each email
  for (const emailChunk of emailChunks) {
    try {
      const cached = await getCachedEmbedding(emailChunkToText(emailChunk));
      if (cached) {
        results.push({ id: emailChunk.id, embedding: cached });
      } else {
        // Cache miss - need to generate
        uncachedEmailChunks.push(emailChunk);
      }
    } catch {
      // Cache miss - need to generate
      uncachedEmailChunks.push(emailChunk);
    }
  }

  // Generate embeddings for uncached emails in batches of 99
  if (uncachedEmailChunks.length > 0) {
    console.log(
      `Generating embeddings for ${uncachedEmailChunks.length} emails`
    );

    const BATCH_SIZE = 99;
    for (let i = 0; i < uncachedEmailChunks.length; i += BATCH_SIZE) {
      const batch = uncachedEmailChunks.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          uncachedEmailChunks.length / BATCH_SIZE
        )}`
      );

      const { embeddings } = await embedMany({
        model: "voyage/voyage-4-large",
        values: batch.map(emailChunkToText),
      });

      // Write batch to cache
      for (let j = 0; j < batch.length; j++) {
        const emailChunk = batch[j];
        const embedding = embeddings[j];

        await writeEmbeddingToCache(emailChunkToText(emailChunk), embedding);
        results.push({ id: emailChunk.id, embedding });
      }
    }
  }

  return results;
}

export async function searchWithEmbeddings(
  query: string,
  emailChunks: EmailChunk[]
) {
  // No query = no semantic ranking; return all emails with zero score
  if (!query.trim()) {
    return emailChunks.map((emailChunk) => ({ score: 0, emailChunk }));
  }

  // Load cached embeddings
  const emailEmbeddings = await loadOrGenerateEmbeddings(emailChunks);

  // Generate query embedding
  const { embedding: queryEmbedding } = await embed({
    model: "voyage/voyage-4-lite",
    value: query,
  });

  // Calculate similarity scores
  const results = emailEmbeddings.map(({ id, embedding }) => {
    const emailChunk = emailChunks.find((e) => e.id === id)!;
    const score = cosineSimilarity(queryEmbedding, embedding);
    return { score, emailChunk };
  });

  // Sort by similarity descending
  return results.sort((a, b) => b.score - a.score);
}

const RRF_K = 60;

export function reciprocalRankFusion(
  rankings: { emailChunk: EmailChunk; score: number }[][]
): { emailChunk: EmailChunk; score: number }[] {
  const rrfScores = new Map<string, number>();
  const emailChunkMap = new Map<string, EmailChunk>();

  // Process each ranking list (BM25 and embeddings)
  rankings.forEach((ranking) => {
    ranking.forEach((item, rank) => {
      const currentScore = rrfScores.get(item.emailChunk.id) || 0;

      // Position-based scoring: 1/(k+rank)
      const contribution = 1 / (RRF_K + rank);
      rrfScores.set(item.emailChunk.id, currentScore + contribution);

      emailChunkMap.set(item.emailChunk.id, item.emailChunk);
    });
  });

  // Sort by combined RRF score descending
  return Array.from(rrfScores.entries())
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .map(([emailId, score]) => ({
      score,
      emailChunk: emailChunkMap.get(emailId)!,
    }));
}

export const searchWithRRF = async (
  query: string,
  emailChunks: EmailChunk[]
) => {
  const bm25Ranking = await searchWithBM25(
    query.toLowerCase().split(" "),
    emailChunks
  );
  const embeddingsRanking = await searchWithEmbeddings(query, emailChunks);
  const rrfRanking = reciprocalRankFusion([bm25Ranking, embeddingsRanking]);
  return rrfRanking;
};
