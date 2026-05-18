// src/app/search-for-related-chats.ts
import { DB, loadChats } from "@/lib/persistence-layer";
import { searchWithEmbeddings } from "./search";
import { chatToText, messageHistoryToQuery } from "./utils";
import { MyMessage } from "./api/chat/route";

const CHATS_TO_SEARCH = 3;

export const searchForRelatedChats = async (
  currentChatId: string,
  messages: MyMessage[]
) => {
  // ADDED: Load all chats except the current one
  const allOtherChats = await loadChats().then((chats) =>
    chats.filter((c) => c.id !== currentChatId)
  );

  // ADDED: Convert message history into an embeddable query
  const query = messageHistoryToQuery(messages);

  // ADDED: Search through other chats using embeddings
  const relatedChats = await searchWithEmbeddings(
    query,
    allOtherChats,
    chatToText
  );

  // ADDED: Return only the top 3 most relevant chats
  return relatedChats.slice(0, CHATS_TO_SEARCH);
};
