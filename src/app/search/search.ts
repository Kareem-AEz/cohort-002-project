import { loadChunks } from "@/lib/utils";
import BM25 from "okapibm25";
import MiniSearch from "minisearch";

export interface VaultChunk {
  id: string;
  title: string;
  content: string;
  folder: string;
  tags: string[];
  aliases: string[];
  createdAt: string | null;
  modifiedAt: string | null;
  wordCount: number;
  chunkIndex: number;
  chunkTotal: number;
  sourcePath: string;
}

const loadDocs = async (query: string) => {
  const chunks = await loadChunks();
  const miniSearch = new MiniSearch({
    storeFields: ["id"],
    fields: ["title", "content", "folder", "sourcePath", "tags", "aliases"],
    searchOptions: {
      prefix: true,
      fuzzy: 0.15,
      boost: { title: 3, tags: 2 },
    },
  });

  miniSearch.addAll(chunks);

  return miniSearch.search(query.trim().toLocaleLowerCase());
};

export const BM25Search = async (query: string) => {
  const results = await loadDocs(query);
  return results;
};
