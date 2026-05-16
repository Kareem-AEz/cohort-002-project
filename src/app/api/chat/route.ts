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

const myTools = {
  searchTool,
  filterTool,
} satisfies ToolSet;

export type MyTools = InferUITools<typeof myTools>;

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

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
    messages: UIMessage[];
    id: string;
  } = await req.json();

  const chatId = body.id;

  const validatedMessagesResult = await safeValidateUIMessages<MyMessage>({
    messages: body.messages,
  });

  if (!validatedMessagesResult.success) {
    return new Response(validatedMessagesResult.error.message, { status: 400 });
  }

  const messages = validatedMessagesResult.data;

  let chat = await getChat(chatId);
  const mostRecentMessage = messages[messages.length - 1];

  if (!mostRecentMessage) {
    return new Response("No messages provided", { status: 400 });
  }

  if (mostRecentMessage.role !== "user") {
    return new Response("Last message must be from the user", {
      status: 400,
    });
  }

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

      const result = streamText({
        model,
        system: [
          `You are an email assistant. Today is ${new Date().toISOString().slice(0, 10)}.`,
          ``,
          `Tools available:`,
          `- filterTool: exact retrieval by sender, recipient, body substring, or date range. Use it when the user names concrete fields, like "emails from alice last week".`,
          `- searchTool: keyword and semantic ranking. Use it for topical or open-ended questions, like "what did we decide about pricing?".`,
          `You can combine them. For example, filter to a sender or date window first, then search within those results.`,
          ``,
          `Answer only from emails you actually retrieved. Quote subject and sender when it helps the user verify. If a tool returns nothing relevant, say so plainly. Do not invent senders, subjects, or contents.`,
          ``,
          `Voice: write like a colleague over chat. Plain language, short sentences. Do not use em dashes; use a comma, period, or parentheses instead. Skip filler openers like "Great question" or "I'd be happy to", and skip closing pleasantries. Avoid hedging adverbs like "simply", "essentially", or "actually". Match length to the question; a short question gets a short answer. Use prose by default and only reach for bullets when the content is genuinely a list.`,
        ].join("\n"),
        messages: await convertToModelMessages(messages),
        tools: myTools,
        stopWhen: [stepCountIs(10)],
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
    onFinish: async ({ responseMessage }) => {
      await appendToChatMessages(chatId, [responseMessage]);
    },
  });

  // send sources and reasoning back to the client
  return createUIMessageStreamResponse({
    stream,
  });
}
