import { devToolsMiddleware } from "@ai-sdk/devtools";
import { gateway, wrapLanguageModel } from "ai";
import { evalite } from "evalite";
import { answerSimilarity } from "evalite/scorers";
import { extractMemories } from "@/app/api/chat/extract-memories";
import { MyMessage } from "@/app/api/chat/route";
import { createUIMessageFixture } from "./create-ui-message-fixture";

const modelFlash = wrapLanguageModel({
  model: gateway("deepseek/deepseek-v4-flash"),
  middleware:
    process.env.NODE_ENV === "development" ? [devToolsMiddleware()] : [],
});

const modelPro = wrapLanguageModel({
  model: gateway("deepseek/deepseek-v4-pro"),
  middleware:
    process.env.NODE_ENV === "development" ? [devToolsMiddleware()] : [],
});

const judgeEmbeddingModel = "voyage/voyage-4";

const formatAdditions = (additions: { title: string; content: string }[]) =>
  additions
    .map((addition) => `${addition.title}: ${addition.content}`)
    .join("\n");

const ADDITION_SIMILARITY_SCORER = "Addition Similarity";
/** Raw cosine similarity ≥ this value scores 1 (pass). */
const ADDITION_SIMILARITY_THRESHOLD = 0.82;
evalite.each([
  { name: "deepseek-v4-flash", input: modelFlash },
  { name: "deepseek-v4-pro", input: modelPro },
])("Extract When Memories are Empty", {
  data: [
    {
      input: createUIMessageFixture<MyMessage>(
        "I'm a software engineer at Google."
      ),
      expected: "User is a software engineer at Google",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "I need to email Michelle about the project deadline."
      ),
      expected: null,
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "I work as a product manager at Microsoft. I love rock climbing and playing guitar. My primary programming language is TypeScript."
      ),
      expected:
        "User works as a product manager at Microsoft. User loves rock climbing and playing guitar. User's primary programming language is TypeScript.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "Can you help me with a bug I'm having? I'm feeling tired today. By the way, I have a golden retriever named Max and I prefer dark mode in all my applications."
      ),
      expected:
        "User has a golden retriever named Max. User prefers dark mode in all their applications.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "Hi, I need help with my React project.",
        "Sure, I'd be happy to help! What's the issue?",
        "I'm building a dashboard. I work remotely from Portland, Oregon.",
        "That's great! What kind of dashboard are you building?",
        "It's for tracking fitness goals. I'm really into marathon running and I train 5 days a week. I also follow a vegetarian diet.",
        "Sounds like a great project! What technology stack are you using?",
        "I'm using Next.js and TypeScript. I've been a full-stack developer for 8 years now."
      ),
      expected:
        "User is building a dashboard for tracking fitness goals. User works remotely from Portland, Oregon. User is a full-stack developer for 8 years now. User is into marathon running and trains 5 days a week. User follows a vegetarian diet.",
    },
  ],
  task: async (input, model) => {
    const { updates, deletions, additions } = await extractMemories({
      messages: input,
      memories: [],
      model,
    });

    return { updates, deletions, additions };
  },
  scorers: [
    {
      name: "Updates",
      description: "The number of updates should be 0",
      scorer: ({ output }) => (output.updates.length === 0 ? 1 : 0),
    },
    {
      name: "Deletions",
      description: "The number of deletions should be 0",
      scorer: ({ output }) => (output.deletions.length === 0 ? 1 : 0),
    },
    {
      name: ADDITION_SIMILARITY_SCORER,
      description: `Addition similarity ≥ ${ADDITION_SIMILARITY_THRESHOLD * 100}% scores 1`,
      scorer: async ({ output, expected }) => {
        const generated = formatAdditions(output.additions);

        if (expected === null) {
          const score = output.additions.length === 0 ? 1 : 0;
          return {
            score,
            metadata: {
              expected: "(none — no memories expected)",
              generated: generated || "(none — no memories added)",
            },
          };
        }

        const similarity = await answerSimilarity({
          answer: generated,
          reference: expected,
          embeddingModel: judgeEmbeddingModel,
        });

        const rawSimilarity = similarity.score;

        return {
          score: rawSimilarity >= ADDITION_SIMILARITY_THRESHOLD ? 1 : 0,
          metadata: {
            expected,
            generated,
            rawSimilarity,
            threshold: ADDITION_SIMILARITY_THRESHOLD,
            passed: rawSimilarity >= ADDITION_SIMILARITY_THRESHOLD,
          },
        };
      },
    },
  ],
  columns: ({ output, expected, scores }) => {
    const similarityScore = scores.find(
      (s) => s.name === ADDITION_SIMILARITY_SCORER
    );
    const metadata = similarityScore?.metadata as
      | {
          expected: string | null;
          generated: string;
          rawSimilarity?: number;
          threshold?: number;
          passed?: boolean;
        }
      | undefined;
    const generatedText =
      metadata?.generated ?? formatAdditions(output.additions);

    return [
      {
        label: "Pass (≥85%)",
        value: similarityScore?.score,
      },
      {
        label: "Raw Similarity",
        value: metadata?.rawSimilarity,
      },
      {
        label: "Expected",
        value:
          metadata?.expected ?? expected ?? "(none — no memories expected)",
      },
      {
        label: "Generated",
        value: generatedText || "(none — no memories added)",
      },
    ];
  },
});
