import MiniSearch from "minisearch";
import { VaultChunk, VaultFields } from "./types";
import fs from "fs/promises";
import path from "path";

// Extended result type that attaches MiniSearch metadata to each VaultChunk.
// `score` and `rank` are pre-computed for future Reciprocal Rank Fusion (RRF).
// `match` tells us which query terms hit which fields (useful for highlighting).
export interface LexicalSearchResult extends VaultChunk {
  score: number;
  rank: number;
  match: Record<string, string[]>;
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

export const lexicalSearch = async (
  query: string
): Promise<LexicalSearchResult[]> => {
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
  const results = miniSearch.search(query.trim());

  // Map MiniSearch results back to full VaultChunk objects using `chunkMap`.
  // BUGFIX: removed `chunkMap!` non-null assertion. `chunkMap` is guaranteed
  // to be set because `getIndex()` populates it, but we handle the edge case
  // safely in case a chunk id is missing from the map.
  return results.map((result, i) => {
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
