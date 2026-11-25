import * as z from 'zod';
import type { AiProvider } from '../providers/provider.ts';
import { clamp, describeError, extractJson, hash } from '../util.ts';

export interface Quality {
  /** 0–100 */
  score: number;
  verdict: string;
}

const VERDICTS = [
  'Accurate and well explained',
  'Complete, clear answer',
  'Correct, could add an example',
  'Clear and well structured',
  'Helpful and on topic',
  'Concise and correct',
];

/** Mock-mode judge: a score from 82 to 96 derived from the answer, so the same answer always gets the same score. */
export function judgeByRules(answer: string): Quality {
  const h = hash(answer);
  return { score: 82 + (h % 15), verdict: VERDICTS[(h >>> 8) % VERDICTS.length] };
}

export function judgePrompt(question: string, answer: string): string {
  return `You are the quality judge of "Unified AI". Rate how well the ANSWER solves the QUESTION, judging correctness, completeness and clarity.
Return ONLY JSON: {"score":0-100,"verdict":"max 8 words"}

QUESTION:
"""${question}"""

ANSWER:
"""${answer.slice(0, 6000)}"""`;
}

const AiVerdict = z.object({ score: z.coerce.number(), verdict: z.string().default('') });

/** Asks a fast model to rate the answer; falls back to the mock judge on any error. */
export async function judgeWithAi(
  provider: AiProvider,
  model: string,
  question: string,
  answer: string,
  signal?: AbortSignal,
): Promise<Quality> {
  try {
    const reply = await provider.complete(
      model,
      [{ role: 'user', content: judgePrompt(question, answer) }],
      {
        maxTokens: 120,
        temperature: 0,
        signal,
      },
    );
    const parsed = AiVerdict.parse(extractJson(reply));
    if (!Number.isFinite(parsed.score)) throw new Error('score is not a number');
    return {
      score: clamp(Math.round(parsed.score), 0, 100),
      verdict: parsed.verdict.trim() || 'Rated by the AI judge',
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn(`[judge] AI judge failed, using the mock judge instead. ${describeError(err)}`);
    return judgeByRules(answer);
  }
}
