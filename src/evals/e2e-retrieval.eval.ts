import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { evalite } from "evalite";
import { createUIMessageFixture } from "./create-ui-message-fixture";
import { createAgent } from "@/app/api/chat/agent";
import {
  convertToModelMessages,
  gateway,
  stepCountIs,
  wrapLanguageModel,
} from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import { MyMessage } from "@/app/api/chat/route";
import { factualityScorer } from "./scorers/factuality";
import { messageToText } from "@/app/utils";

const SCORER_RESULTS_DIR = path.join(
  process.cwd(),
  "eval-results",
  "e2e-retrieval"
);

const toResultSlug = (question: string) =>
  question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "eval-case";

const writeScorerResult = async ({
  question,
  answer,
  expected,
  toolCalls,
  result,
}: {
  question: string;
  answer: string;
  expected: string;
  toolCalls: unknown;
  result: Awaited<ReturnType<typeof factualityScorer>>;
}) => {
  await mkdir(SCORER_RESULTS_DIR, { recursive: true });
  const filePath = path.join(
    SCORER_RESULTS_DIR,
    `${toResultSlug(question)}.json`
  );
  await writeFile(
    filePath,
    JSON.stringify(
      {
        writtenAt: new Date().toISOString(),
        question,
        answer,
        expected,
        toolCalls,
        score: result.score,
        metadata: result.metadata,
      },
      null,
      2
    )
  );
  return filePath;
};

const model = wrapLanguageModel({
  model: gateway("deepseek/deepseek-v4-flash"),
  middleware:
    process.env.NODE_ENV === "development" ? [devToolsMiddleware()] : [],
});

const reviewModel = wrapLanguageModel({
  model: gateway("deepseek/deepseek-v4-pro"),
  middleware:
    process.env.NODE_ENV === "development" ? [devToolsMiddleware()] : [],
});

evalite("E2E Retrieval", {
  data: [
    {
      input: createUIMessageFixture<MyMessage>(
        "Which house did I buy? What is its address?"
      ),
      expected:
        "You bought a house at 42 Victoria Grove, Chorlton, Manchester M21 9EH.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "What was the name of the person I was mentoring, and what was I mentoring them about?"
      ),
      expected: "You were mentoring Elena Kovac on the subject of climbing.",
    },
    {
      input: createUIMessageFixture<MyMessage>("Am I married? If so, who to?"),
      expected: "You are not married. Your partner is Alex Chen.",
    },
  ],
  task: async (input) => {
    const agent = createAgent({
      messages: input,
      model,
      memories: [],
      relatedChats: [],
      stopWhen: [stepCountIs(20)],
    });

    const result = await agent.generate({
      messages: await convertToModelMessages(input),
    });

    return {
      text: result.text,
      toolCalls: result.steps.flatMap((step) => step.toolCalls),
    };
  },
  scorers: [
    {
      name: "Factuality",
      async scorer({ input, output, expected }) {
        const question = input.map(messageToText).join("\n");
        const result = await factualityScorer({
          question,
          answer: output.text,
          reference: expected,
          model: reviewModel,
        });

        const filePath = await writeScorerResult({
          question,
          answer: output.text,
          expected,
          toolCalls: output.toolCalls,
          result,
        });

        return {
          ...result,
          metadata: {
            ...result.metadata,
            resultFile: filePath,
          },
        };
      },
    },
  ],
  columns({ input, output, expected, scores }) {
    const factuality = scores.find((s) => s.name === "Factuality");
    const metadata = factuality?.metadata as
      | {
          facts?: { fact: string; supported: boolean; reason: string }[];
          supportedCount?: number;
          totalFacts?: number;
          resultFile?: string;
        }
      | undefined;

    return [
      {
        label: "Input",
        value: input,
      },
      {
        label: "Summary",
        value: output.text,
      },
      {
        label: "Tool Calls",
        value: output.toolCalls,
      },
      {
        label: "Expected",
        value: expected,
      },
      {
        label: "Score",
        value: factuality?.score,
      },
      {
        label: "Facts",
        value:
          metadata?.totalFacts !== undefined
            ? `${metadata.supportedCount ?? 0} / ${metadata.totalFacts}`
            : undefined,
      },
      {
        label: "Result File",
        value: metadata?.resultFile,
      },
    ];
  },
});
