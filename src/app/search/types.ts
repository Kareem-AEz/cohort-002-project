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

export type VaultFields = keyof VaultChunk;
