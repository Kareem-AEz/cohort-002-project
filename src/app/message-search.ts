import { MyMessage } from "./api/chat/route";
import { searchWithEmbeddings } from "./search";
import { messageHistoryToQuery, messageToText } from "./utils";

// ADDED: Function to search older messages using recent messages as context
export const searchMessages = async (opts: {
  recentMessages: MyMessage[];
  olderMessages: MyMessage[];
}) => {
  // ADDED: Early return if no older messages to search
  if (opts.olderMessages.length === 0) {
    return [];
  }

  // ADDED: Convert recent messages into an embedding query
  const query = messageHistoryToQuery(opts.recentMessages);

  // ADDED: Search older messages using embeddings with messageToText converter
  const embeddingsRanking = await searchWithEmbeddings(
    query,
    opts.olderMessages,
    messageToText
  );

  return embeddingsRanking;
};
