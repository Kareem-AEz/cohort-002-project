import MiniSearch from "minisearch";
import { VaultChunk, VaultFields } from "./types";
import fs from "fs/promises";
import path from "path";
import { cosineSimilarity, embed, embedMany } from "ai";
import { GoogleGenerativeAIEmbeddingProviderOptions } from "@ai-sdk/google";

const CACHE_DIR = path.join(process.cwd(), "data", "embeddings");
const CACHE_KEY = "gemini-embedding-2";

const getEmbeddingFilePath = (id: string) => {
  const safeId = id.replace(/[\\/]/g, "_");
  return path.join(CACHE_DIR, `${CACHE_KEY}-${safeId}.json`);
};

export const loadOrGenerateEmbeddings = async (VaultChunk: VaultChunk[]) => {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const results: { id: string; embedding: number[] }[] = [];
  const unCachedChunks: VaultChunk[] = [];

  for (const chunk of VaultChunk) {
    try {
      // cache hit
      const cached = await fs.readFile(getEmbeddingFilePath(chunk.id), "utf-8");
      const data: { id: string; embedding: number[] } = JSON.parse(cached);
      results.push({ id: chunk.id, embedding: data.embedding });
    } catch (error) {
      // cache miss
      unCachedChunks.push(chunk);
    }
  }

  if (unCachedChunks.length > 0) {
    console.log(`Generating embeddings for ${unCachedChunks.length} chunks...`);

    const batchSize = 100;
    for (let i = 0; i < unCachedChunks.length; i += batchSize) {
      const batch = unCachedChunks.slice(i, i + batchSize);

      console.log(
        `Generating embeddings for batch ${i / batchSize + 1} of ${Math.ceil(unCachedChunks.length / batchSize)}...`
      );

      const batchEmbeddings = await embedMany({
        model: "google/gemini-embedding-2",
        values: batch.map((chunk) => `${chunk.title}\n${chunk.content}`),
      });

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const embedding = batchEmbeddings.embeddings[j];
        results.push({ id: chunk.id, embedding });
        await fs.writeFile(
          getEmbeddingFilePath(chunk.id),
          JSON.stringify({ id: chunk.id, embedding }),
          "utf-8"
        );
      }
    }
  }

  return results;
};

// Extended result type that attaches MiniSearch metadata to each VaultChunk.
// `score` and `rank` are pre-computed for future Reciprocal Rank Fusion (RRF).
// `match` tells us which query terms hit which fields (useful for highlighting).
export interface SearchResult extends VaultChunk {
  score: number;
}

// Module-level caches so we only load + index the dataset once per server instance.
let index: MiniSearch<VaultChunk> | null = null;
let chunkMap: Map<string, VaultChunk> | null = null;
let cachedChunks: VaultChunk[] | null = null;

export async function loadChunks(): Promise<VaultChunk[]> {
  const filePath = path.join(process.cwd(), "data", "my-dataset.json");
  // BUGFIX: was `fstat.readFile` — `fstat` does not exist. Use `fs.readFile`.
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}

const getIndex = async () => {
  // Return existing index if already built.
  if (index) return index;

  // Load chunks once and cache them in module scope.
  const chunks = await loadChunks();
  cachedChunks = chunks;

  // Build an O(1) lookup map so we can reconstruct full VaultChunk objects
  // from MiniSearch results (which only return `id`, `score`, and `match`).
  chunkMap = new Map(chunks.map((c) => [c.id, c]));

  index = new MiniSearch({
    storeFields: ["id"],
    fields: ["title", "content", "folder", "sourcePath", "tags", "aliases"],
    extractField(document, fieldName) {
      // MiniSearch types `fieldName` as `string`, but we know it is a key of VaultChunk.
      const v = document[fieldName as VaultFields];
      // Join string arrays (tags, aliases) so MiniSearch indexes each word individually
      // instead of treating the comma-joined array as a single opaque term.
      return Array.isArray(v) ? v.join(" ") : v;
    },
    searchOptions: {
      prefix: true, // "sched" matches "scheduling"
      fuzzy: 0.15, // light typo tolerance
      boost: { title: 3, tags: 2 }, // title hits are 3x more valuable than content
    },
  });

  index.addAll(chunks);
  return index;
};

export const lexicalSearch = async (query: string): Promise<SearchResult[]> => {
  const miniSearch = await getIndex();

  // Empty query: return all cached chunks in original order.
  // We use `cachedChunks` (set during `getIndex`) instead of calling `loadChunks()`
  // again — this avoids a redundant file-read on every empty-query request.
  if (!query.trim()) {
    return (cachedChunks ?? []).map((chunk, i) => ({
      ...chunk,
      score: 0,
      match: {},
      rank: i + 1,
    }));
  }

  // Run the actual MiniSearch query.
  const lexicalResults = miniSearch.search(query.trim());

  // Map MiniSearch results back to full VaultChunk objects using `chunkMap`.
  // BUGFIX: removed `chunkMap!` non-null assertion. `chunkMap` is guaranteed
  // to be set because `getIndex()` populates it, but we handle the edge case
  // safely in case a chunk id is missing from the map.
  return lexicalResults.map((result, i) => {
    const chunk = chunkMap?.get(result.id);
    if (!chunk) {
      throw new Error(`Missing chunk for id: ${result.id}`);
    }

    return {
      ...chunk,
      score: result.score,
      match: result.match,
      rank: i + 1,
    };
  });
};

export const semanticSearch = async (
  query: string,
  chunks: VaultChunk[]
): Promise<SearchResult[]> => {
  const embeddings = await loadOrGenerateEmbeddings(chunks);
  const queryEmbedding = await embed({
    model: "google/gemini-embedding-2",
    value: query,
  });

  const results = embeddings.map((embedding) => {
    const similarity = cosineSimilarity(
      queryEmbedding.embedding,
      embedding.embedding
    );
    const chunk = chunks.find((c) => c.id === embedding.id);

    if (!chunk) throw new Error(`Missing chunk for id: ${embedding.id}`);


    return {
      ...chunk,
      score: similarity,
    };
  });


  return results.sort((a, b) => b.score - a.score);
}; 