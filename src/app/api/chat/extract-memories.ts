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
  NoObjectGeneratedError,
  Output,
  wrapLanguageModel,
  gateway,
  LanguageModel,
} from "ai";
import { z } from "zod";
import { MyMessage } from "./route";
import { memoryToText } from "@/app/memory-search";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import { type DeepSeekLanguageModelOptions } from "@ai-sdk/deepseek";

const memoriesSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().describe("The ID of the existing memory to update"),
        title: z.string().describe("The updated memory title"),
        content: z.string().describe("The updated memory content"),
      })
    )
    .default([])
    .describe("Memories to update"),
  deletions: z
    .array(z.string())
    .default([])
    .describe("Array of memory IDs to delete"),
  additions: z
    .array(
      z.object({
        title: z.string().describe("The memory title"),
        content: z.string().describe("The memory content"),
      })
    )
    .default([])
    .describe("New memories to add"),
});

type MemoriesResult = z.infer<typeof memoriesSchema>;

const emptyMemoriesResult = (): MemoriesResult => ({
  updates: [],
  deletions: [],
  additions: [],
});

const extractJsonObject = (text: string): unknown | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

const parseMemoriesFromText = (
  text: string | undefined
): MemoriesResult | null => {
  if (!text) {
    return null;
  }

  const parsed = memoriesSchema.safeParse(extractJsonObject(text));
  return parsed.success ? parsed.data : null;
};

const extractReasoningTextFromResponse = (
  response: unknown
): string | undefined => {
  if (!response || typeof response !== "object" || !("body" in response)) {
    return undefined;
  }

  const body = (response as { body?: { content?: unknown } }).body;
  if (!body?.content || !Array.isArray(body.content)) {
    return undefined;
  }

  return body.content
    .filter(
      (part): part is { type: string; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "reasoning" &&
        "text" in part &&
        typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n");
};

const recoverMemoriesFromObjectError = (
  error: NoObjectGeneratedError
): MemoriesResult | null => {
  const fromText = parseMemoriesFromText(error.text);
  if (fromText) {
    return fromText;
  }

  const fromReasoning = parseMemoriesFromText(
    extractReasoningTextFromResponse(error.response)
  );
  if (fromReasoning) {
    return fromReasoning;
  }

  if (error.text === "{}" || error.text === "") {
    return emptyMemoriesResult();
  }

  return null;
};

const buildMemoryExtractionSystemPrompt = (memories: DB.Memory[]) =>
  `You are a memory management agent that extracts and maintains permanent information about the user from conversations.

<existing-memories>
${memories
  .map((memory) => `<memory id="${memory.id}">${memoryToText(memory)}</memory>`)
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

Be conservative - only add memories that will genuinely help personalize future conversations.`;

export const extractMemories = async ({
  messages,
  memories,
  model,
}: {
  messages: MyMessage[];
  memories: DB.Memory[];
  model: LanguageModel;
}) => {
  const filteredMessages = messages.filter(
    (message) => message.role === "user" || message.role === "assistant"
  );
  const modelMessages = await convertToModelMessages(filteredMessages);
  const system = buildMemoryExtractionSystemPrompt(memories);

  try {
    const result = await generateText({
      model,
      maxOutputTokens: 2000,
      providerOptions: {
        deepseek: {
          reasoningEffort: "xhigh",
        } satisfies DeepSeekLanguageModelOptions,
      },
      output: Output.object({
        name: "memories",
        description:
          "Memory operations with updates, deletions, and additions arrays",
        schema: memoriesSchema,
      }),
      system: `${system}

Use your thinking to reason carefully before responding.
Your final structured response must include all three keys: updates, deletions, additions.
When nothing applies, return {"updates":[],"deletions":[],"additions":[]}.
Never return an empty object {}.`,
      messages: modelMessages,
    });

    return result.output;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      const recovered = recoverMemoriesFromObjectError(error);
      if (recovered) {
        return recovered;
      }
    }
    throw error;
  }
};

export async function extractAndUpdateMemories(opts: {
  messages: MyMessage[];
  memories: DB.Memory[];
}) {
  const filteredMessages = opts.messages.filter(
    (message) => message.role === "user" || message.role === "assistant"
  );

  const model = wrapLanguageModel({
    model: gateway("deepseek/deepseek-v4-flash"),
    middleware:
      process.env.NODE_ENV === "development" ? [devToolsMiddleware()] : [],
  });

  const { updates, deletions, additions } = await extractMemories({
    messages: filteredMessages,
    memories: opts.memories,
    model,
  });

  const filteredDeletions = deletions.filter(
    (deletion) => !updates.some((update) => update.id === deletion)
  );

  await Promise.all(
    updates.map((update) =>
      updateMemory(update.id, {
        title: update.title,
        content: update.content,
      })
    )
  );

  await Promise.all(
    filteredDeletions.map((deletion) => deleteMemory(deletion))
  );

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
