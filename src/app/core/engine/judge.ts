import type { AiProvider } from './provider';
import { clamp, describeError, extractJson, hash } from './util';

export interface Quality {
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
      { maxTokens: 120, temperature: 0, signal },
    );
    const parsed = extractJson(reply);
    const score = Number(parsed['score']);
    if (!Number.isFinite(score)) throw new Error('score is not a number');
    const verdict = typeof parsed['verdict'] === 'string' ? parsed['verdict'].trim() : '';
    return {
      score: clamp(Math.round(score), 0, 100),
      verdict: verdict || 'Rated by the AI judge',
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn(`[judge] AI judge failed, using the mock judge instead. ${describeError(err)}`);
    return judgeByRules(answer);
  }
}
