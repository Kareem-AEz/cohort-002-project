import { VaultChunk } from "@/app/search/search";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import fs from "fs/promises";
import path from "path";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function loadChunks(): Promise<VaultChunk[]> {
  const filePath = path.join(process.cwd(), "data", "my-dataset.json");
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}
