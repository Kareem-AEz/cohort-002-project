import {
  appendToChatMessages,
  createChat,
  DB,
  getChat,
  updateChatTitle,
} from "@/lib/persistence-layer";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  gateway,
  safeValidateUIMessages,
  streamText,
  ToolSet,
  UIMessage,
  wrapLanguageModel,
  InferUITools,
  stepCountIs,
} from "ai";
import { generateTitleForChat } from "./generate-title";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import { searchTool } from "./search-tool";
import { filterTool } from "./filter-tool";
import { getEmailsTool } from "./get-emails-tool";
import { memoryToText, searchMemories } from "@/app/memory-search";
import { extractAndUpdateMemories } from "./extract-memories";
import { searchMessages } from "@/app/message-search";
import { searchForRelatedChats } from "@/app/search-for-related-chats";
import { chatToText } from "@/app/utils";
import { reflectOnChat } from "@/app/reflect-on-chat";
import { createAgent } from "./agent";

const myTools = {
  searchTool,
  filterTool,
  getEmailsTool,
} satisfies ToolSet;

export type MyTools = InferUITools<typeof myTools>;

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

const MEMORIES_TO_USE = 3;
const MESSAGE_HISTORY_TO_SEARCH = 10;
const OLD_MESSAGES_TO_SEARCH = 20;

export type MyMessage = UIMessage<
  never,
  {
    "frontend-action": "refresh-sidebar";
  },
  MyTools
>;

const model = wrapLanguageModel({
  model: gateway("deepseek/deepseek-v4-flash"),
  middleware:
    process.env.NODE_ENV === "development" ? [devToolsMiddleware()] : [],
});

export async function POST(req: Request) {
  const body: {
    message: MyMessage;
    id: string;
  } = await req.json();

  const chatId = body.id;

  let chat = await getChat(chatId);

  console.log("chat id", chatId);

  const validatedMessagesResult = await safeValidateUIMessages<MyMessage>({
    messages: [...(chat?.messages || []), body.message],
  });

  if (!validatedMessagesResult.success) {
    console.log(
      "validatedMessagesResult",
      validatedMessagesResult.error.message
    );
    return new Response(validatedMessagesResult.error.message, { status: 400 });
  }

  const messages = validatedMessagesResult.data;

  const recentMessages = messages.slice(-MESSAGE_HISTORY_TO_SEARCH); // gets the most recent MESSAGE_HISTORY_TO_SEARCH messages
  const olderMessages = messages.slice(0, -MESSAGE_HISTORY_TO_SEARCH); // gets all earlier messages except the most recent MESSAGE_HISTORY_TO_SEARCH

  const mostRecentMessage = messages[messages.length - 1];

  if (!mostRecentMessage) {
    return new Response("No messages provided", { status: 400 });
  }

  if (mostRecentMessage.role !== "user") {
    return new Response("Last message must be from the user", {
      status: 400,
    });
  }

  const memories = await searchMemories({ messages });
  const memoriesToUse = memories.slice(0, MEMORIES_TO_USE);

  const oldMessagesToUse = await searchMessages({
    recentMessages,
    olderMessages,
  }).then((results) =>
    results.slice(0, OLD_MESSAGES_TO_SEARCH).map((result) => result.item)
  );

  console.log("oldMessagesToUse", oldMessagesToUse.length);
  const messageHistoryToUse = [...oldMessagesToUse, ...recentMessages];

  console.log("messageHistoryToUse", messageHistoryToUse.length);

  const stream = createUIMessageStream<MyMessage>({
    execute: async ({ writer }) => {
      let generateTitlePromise: Promise<void> | undefined = undefined;

      if (!chat) {
        const newChat = await createChat({
          id: chatId,
          title: "Generating title...",
          initialMessages: messages,
        });
        chat = newChat;

        writer.write({
          type: "data-frontend-action",
          data: "refresh-sidebar",
          transient: true,
        });

        generateTitlePromise = generateTitleForChat(messages)
          .then((title) => {
            return updateChatTitle(chatId, title);
          })
          .then(() => {
            writer.write({
              type: "data-frontend-action",
              data: "refresh-sidebar",
              transient: true,
            });
          });
      } else {
        await appendToChatMessages(chatId, [mostRecentMessage]);
      }
      const relatedChats = await searchForRelatedChats(
        chatId,
        messageHistoryToUse
      );

      const agent = createAgent({
        messages,
        model,
        memories: memoriesToUse.map((memory) => memory.item),
        relatedChats: relatedChats.map((chat) => chat.item),
        stopWhen: [stepCountIs(10)],
      });

      const result = await agent.stream({
        messages: await convertToModelMessages(messageHistoryToUse),
      });

      writer.merge(
        result.toUIMessageStream({
          sendSources: true,
          sendReasoning: true,
        })
      );

      await generateTitlePromise;
    },
    generateId: () => crypto.randomUUID(),
    // src/app/api/chat/route.ts
    onFinish: async ({ responseMessage }) => {
      await appendToChatMessages(chatId, [responseMessage]);

      try {
        await extractAndUpdateMemories({
          messages: [...messages, responseMessage],
          memories: memories.map((memory) => memory.item),
        });
      } catch (error) {
        console.error("extractAndUpdateMemories failed:", error);
      }

      try {
        await reflectOnChat(chatId);
      } catch (error) {
        console.error("reflectOnChat failed:", error);
      }
    },
  });

  // send sources and reasoning back to the client
  return createUIMessageStreamResponse({
    stream,
  });
}
