import { DB } from "@/lib/persistence-layer";
import { MyMessage } from "./api/chat/route";

/**
 * Converts an array of message parts into a single text string, concatenating all "text" parts separated by newlines.
 *
 * @param parts - Array of message parts, each may have different types (e.g., "text", "image", etc.)
 * @returns Concatenated text content from all "text" parts, separated by newlines.
 *
 * @example
 * const parts = [
 *   { type: "text", text: "hello" },
 *   { type: "image", url: "image.png" },
 *   { type: "text", text: "world" }
 * ];
 * console.log(messagePartsToText(parts)); // "hello\nworld"
 */
export const messagePartsToText = (parts: MyMessage["parts"]) => {
  return parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter((s) => typeof s === "string")
    .join("\n");
};

/**
 * Converts a message object into a human-readable string, showing the sender's role and the concatenated text parts.
 *
 * @param message - The message object to convert.
 * @returns A string in the format "role: text", where text includes all "text" parts joined by newlines.
 *
 * @example
 * const message = {
 *   role: "user",
 *   parts: [
 *     { type: "text", text: "How are you?" },
 *     { type: "image", url: "mood.png" }
 *   ]
 * };
 * console.log(messageToText(message)); // "user: How are you?"
 */
export const messageToText = (message: MyMessage) => {
  return `${message.role}: ${messagePartsToText(message.parts)}`;
};

/**
 * Builds a search query string from chat history, emphasizing the latest message.
 *
 * Duplicates the most recent message at the end of the list (so it appears twice),
 * keeps at most the first 15 entries, formats each as "role: text", and joins with newlines.
 *
 * @param messages - Conversation history, oldest to newest.
 * @returns A newline-separated query string for retrieval (e.g. hybrid search).
 *
 * @example
 * const messages = [
 *   { role: "user", parts: [{ type: "text", text: "Find my invoice" }] },
 *   { role: "assistant", parts: [{ type: "text", text: "Which month?" }] },
 *   { role: "user", parts: [{ type: "text", text: "March 2024" }] },
 * ];
 * console.log(messageHistoryToQuery(messages));
 * // "user: Find my invoice\nassistant: Which month?\nuser: March 2024\nuser: March 2024"
 */
export const messageHistoryToQuery = (messages: MyMessage[]) => {
  const mostRecentMessage = messages[messages.length - 1];

  const query = [...messages, mostRecentMessage]
    .slice(0, 15)
    .map(messageToText)
    .join("\n");

  return query;
};

// src/app/utils.ts
// ADDED: New utility to convert chat to text format for LLM processing
export const chatToText = (chat: DB.Chat): string => {
  const frontmatter = [`Title: ${chat.title}`];

  // ADDED: Include LLM summary if it exists
  const summary = chat.llmSummary
    ? [
        `Summary: ${chat.llmSummary.summary}`,
        `What Worked Well: ${chat.llmSummary.whatWorkedWell}`,
        `What To Avoid: ${chat.llmSummary.whatToAvoid}`,
        `Tags: ${chat.llmSummary.tags.join(", ")}`,
      ]
    : [];

  // ADDED: Convert all messages to text format
  const messages = chat.messages.map(messageToText).join("\n");

  return [...frontmatter, ...summary, messages].join("\n");
};
