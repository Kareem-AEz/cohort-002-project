import { DB, loadMemories } from "@/lib/persistence-layer";
import { MyMessage } from "./api/chat/route";
import { messageHistoryToQuery } from "./utils";
import { searchWithEmbeddings } from "./search";

export const memoryToText = (memory: DB.Memory) => {
  return `${memory.title}: ${memory.content}`;
};

export const searchMemories = async ({
  messages,
}: {
  messages: MyMessage[];
}) => {
  const memories = await loadMemories();

  const query = messageHistoryToQuery(messages);

  const embeddingsRanking = await searchWithEmbeddings(
    query,
    memories,
    memoryToText
  );

  return embeddingsRanking;
};
