import {
  createMemory,
  DB,
  deleteMemory,
  loadMemories,
  updateMemory,
} from "@/lib/persistence-layer";
import {
  convertToModelMessages,
  generateText,
  Output,
  wrapLanguageModel,
  gateway,
} from "ai";
import { z } from "zod";
import { MyMessage } from "./route";
import { memoryToText } from "@/app/memory-search";
import { devToolsMiddleware } from "@ai-sdk/devtools";

export async function extractAndUpdateMemories(opts: {
  messages: MyMessage[];
  memories: DB.Memory[];
}) {
  // ADDED: Filter to only user and assistant messages to save costs
  const filteredMessages = opts.messages.filter(
    (message) => message.role === "user" || message.role === "assistant"
  );

  // src/app/api/chat/extract-memories.ts

  const model = wrapLanguageModel({
    model: gateway("deepseek/deepseek-v4-flash"),
    middleware:
      process.env.NODE_ENV === "development" ? [devToolsMiddleware()] : [],
  });

  const memoriesResult = await generateText({
    model,
    output: Output.object({
      name: "memories",
      description: "The memories to update",
      schema: z.object({
        updates: z
          .array(
            z.object({
              id: z
                .string()
                .describe("The ID of the existing memory to update"),
              title: z.string().describe("The updated memory title"),
              content: z.string().describe("The updated memory content"),
            })
          )
          .describe("Memories to update"),
        deletions: z
          .array(z.string())
          .describe("Array of memory IDs to delete"),
        additions: z
          .array(
            z.object({
              title: z.string().describe("The memory title"),
              content: z.string().describe("The memory content"),
            })
          )
          .describe("New memories to add"),
      }),
    }),
    system: `You are a memory management agent that extracts and maintains permanent information about the user from conversations.
  
  <existing-memories>
  ${opts.memories
    .map(
      (memory) => `<memory id="${memory.id}">${memoryToText(memory)}</memory>`
    )
    .join("\n\n")}
  </existing-memories>
  
  Your job is to:
  1. Analyze the conversation history
  2. Extract NEW permanent facts worth remembering
  3. Update existing memories if they should be modified
  4. Delete memories that are no longer relevant or accurate
  
  Only store PERMANENT information that:
  - Is unlikely to change over time (preferences, traits, characteristics)
  - Will be relevant for weeks, months, or years
  - Helps personalize future interactions
  - Represents lasting facts about the user
  
  Examples of what TO store:
  - "User prefers dark mode in applications"
  - "User works as a software engineer at Acme Corp"
  - "User's primary programming language is TypeScript"
  - "User has a cat named Whiskers"
  
  Examples of what NOT to store:
  - "User asked about the weather today"
  - "User said hello"
  - "User is working on a project" (too temporary)
  - "User mentioned they're hungry" (temporary state)
  
  For each operation:
  - UPDATES: Provide the existing memory ID, new title, and new content
  - DELETIONS: Provide memory IDs that are no longer relevant
  - ADDITIONS: Provide title and content for brand new memories
  
  Be conservative - only add memories that will genuinely help personalize future conversations.`,
    messages: await convertToModelMessages(filteredMessages),
  });

  // src/app/api/chat/extract-memories.ts

  const { updates, deletions, additions } = memoriesResult.output;

  // ADDED: Prevent conflicts between updates and deletions
  const filteredDeletions = deletions.filter(
    (deletion) => !updates.some((update) => update.id === deletion)
  );

  // ADDED: Process all memory updates
  await Promise.all(
    updates.map((update) =>
      updateMemory(update.id, {
        title: update.title,
        content: update.content,
      })
    )
  );

  // ADDED: Process all memory deletions
  await Promise.all(
    filteredDeletions.map((deletion) => deleteMemory(deletion))
  );

  // ADDED: Process all memory additions
  await Promise.all(
    additions.map((addition) =>
      createMemory({
        id: crypto.randomUUID(),
        title: addition.title,
        content: addition.content,
      })
    )
  );
}
