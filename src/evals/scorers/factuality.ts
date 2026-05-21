import { generateText, LanguageModel, Output } from "ai";
import { z } from "zod";

const factualitySchema = z.object({
  facts: z
    .array(
      z.object({
        fact: z
          .string()
          .describe("A single atomic fact extracted from the reference answer."),
        supported: z
          .boolean()
          .describe(
            "True if the actual answer clearly supports this fact, false otherwise."
          ),
        reason: z
          .string()
          .describe(
            "Short explanation grounded in the actual answer text."
          ),
      })
    )
    .describe("One entry per atomic fact found in the reference answer."),
});

const SYSTEM_PROMPT = `You are an evaluation judge.

You will be given a question, a reference answer (the ground truth), and an actual answer produced by an assistant.

Your job:
1. Decompose the reference answer into a list of atomic, independently-verifiable facts. Each fact should be a single claim — split conjunctions and lists into separate facts.
2. For each fact, decide whether the actual answer supports it. A fact is "supported" if the actual answer states the same information, even if phrased differently or surrounded by extra correct details.
3. Do NOT penalize the actual answer for containing additional information that is not in the reference. Only judge whether each reference fact is present.
4. If the reference contains no verifiable facts (e.g. it is empty), return an empty list.

Be strict about what counts as supported: the meaning must match, not just the topic.`;

export const factualityScorer = async (opts: {
  question: string;
  reference: string;
  answer: string;
  model: LanguageModel;
}) => {
  const result = await generateText({
    model: opts.model,
    output: Output.object({
      name: "factuality",
      description: "Per-fact factuality classification of the actual answer.",
      schema: factualitySchema,
    }),
    system: SYSTEM_PROMPT,
    prompt: `Question:\n${opts.question}\n\nReference answer:\n${opts.reference}\n\nActual answer:\n${opts.answer}`,
  });

  const facts = result.output.facts;
  const supported = facts.filter((f) => f.supported).length;
  const score = facts.length === 0 ? 1 : supported / facts.length;

  return {
    score,
    metadata: {
      facts,
      supportedCount: supported,
      totalFacts: facts.length,
    },
  };
};
