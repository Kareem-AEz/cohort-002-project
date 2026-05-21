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

    // --- Multi-hop cases (require stitching facts across threads/arcs) ---
    {
      input: createUIMessageFixture<MyMessage>(
        "What was my mortgage pre-approval amount, and what did I actually end up paying for the house?"
      ),
      expected:
        "You were pre-approved for a £350,000 mortgage by David Xu at First Home Mortgages, and you ended up purchasing 42 Victoria Grove for £437,500.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "Who is my best man, how is he related to me, and what's his email?"
      ),
      expected:
        "Your best man is your brother James, who emails from jamesc.edinburgh@gmail.com.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "When did I register as a sole trader, and which client's invoicing change prompted that conversation?"
      ),
      expected:
        "You registered as a sole trader on 9 March 2025 as 'Sarah Chen Consulting'. Marcus Webb at Wavelength Digital introduced an updated invoicing process for the design system project, which pushed the business-structure conversation forward.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "Who introduced me to Tom Hartley, and what did that lead to?"
      ),
      expected:
        "Priya Sharma (p.sharma@greenpath.io) introduced you to Tom Hartley at Hartley & Co. It led to a design consultation engagement that you accepted in April 2025.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "Where did Alex and I go in New Zealand, when, and how much was the guided tour total?"
      ),
      expected:
        "You went on Adventure South NZ's Ultimate South Island Explorer 10-day guided tour with Alex from 15-24 December 2024. The price was NZ$4,850 per person, NZ$9,700 total for the two of you.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "What's the hardest climbing grade I've sent, who was I with, and where?"
      ),
      expected:
        "You sent a 5.11b clean, with Hannah Price, in the Peak District.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "Where is my wedding venue, who's officiating, and who recommended my photographer?"
      ),
      expected:
        "Your wedding is at The Garden Room in Manchester, officiated by Natasha from Celebrate With Nat, and Martin Hughes recommended your photographer.",
    },

    // --- Filtering cases (should drive `filterEmails`, not `search`) ---
    {
      input: createUIMessageFixture<MyMessage>(
        "What were the last 3 emails I received from David Xu, my mortgage advisor?"
      ),
      expected:
        "The three most recent emails from David Xu (david.xu@firsthomemortgages.co.uk) covered the required documentation checklist for the mortgage application, and the pre-approval confirmation for £350,000. They are the latest three in the thread of five total emails from him in 2024.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "What emails did my mum (mchen1965@gmail.com) send me about my wedding between October 2025 and February 2026?"
      ),
      expected:
        "Two threads from your mum in that window: one in October 2025 ('Wedding plans - how can I help?') asking how she could help with planning, and one in mid-February 2026 ('Travel for your wedding - some questions') asking about travel arrangements.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "How many emails did I exchange with Katie about the NZ trip before we flew out in December 2024?"
      ),
      expected:
        "You exchanged roughly a dozen emails with Katie (katie.z.nz@gmail.com) about the NZ trip in the months leading up to the December departure - covering reconnecting after a long gap, recommendations for South Island stops, detailed climbing-area suggestions, an Auckland hangout plan, and final tips and weather updates.",
    },
    {
      input: createUIMessageFixture<MyMessage>(
        "Find the email where Adventure South NZ confirmed the tour booking - what was the reference code?"
      ),
      expected:
        "The booking confirmation from bookings@adventuresouthnz.com gave booking reference NZ2024-SC01 for the Ultimate South Island Explorer 10-day tour.",
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
