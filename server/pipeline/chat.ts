import { randomUUID } from 'node:crypto';
import type { Benchmarks, Category } from '../catalog.ts';
import type { Mode } from '../config.ts';
import { ProviderError, type AiProvider, type ChatMessage } from '../providers/provider.ts';
import { randomBetween, sleep } from '../util.ts';
import { classifyByRules, classifyWithAi } from './classifier.ts';
import { judgeByRules, judgeWithAi, type Quality } from './judge.ts';
import type { LearnedStore } from './learning.ts';
import { rankModels, type RankedModel } from './router.ts';

export const ANSWER_INSTRUCTIONS =
  "You are answering inside Unified AI. Answer helpfully and concisely in Markdown, in the user's language.";

export const IMAGE_INSTRUCTIONS =
  "The user wants an image, but no image model is connected yet. Write one vivid, ready-to-use image prompt in English inside a ```text code block, then add two or three short design notes in the user's language.";

export const IMAGE_NOTE = '_Image generation preview — connect an image model to render._';

export interface PipelineDeps {
  mode: Mode;
  provider: AiProvider;
  /** Fast model for the classifier and judge in openrouter mode. */
  routerModel: string;
  benchmarks: Benchmarks;
  learned: LearnedStore;
  /** Simulated latency (ms, [min, max]) for the local classifier and judge in mock mode. */
  mockDelays?: { classify: readonly [number, number]; judge: readonly [number, number] };
}

export interface ChatResult {
  id: string;
  routing: {
    category: Category;
    categoryLabel: string;
    confidence: number;
    language: string;
    reason: string;
    /** "rules" in mock mode, or when the AI router failed and the keyword rules stepped in. */
    classifiedBy: 'rules' | 'ai';
    selectedModel: string;
    ranking: RankedModel[];
  };
  answer: string;
  quality: Quality;
  mode: Mode;
  /** Set only when another model had to answer for the selected one (e.g. a text model for DALL·E). */
  answeredBy?: string;
  timings: { classifyMs: number; answerMs: number; judgeMs: number };
}

const DEFAULT_MOCK_DELAYS = { classify: [250, 450], judge: [200, 400] } as const;

/** Classify → compare benchmarks → pick the best model → answer → quality check. */
export async function runChat(
  deps: PipelineDeps,
  message: string,
  history: ChatMessage[],
  signal?: AbortSignal,
): Promise<ChatResult> {
  const { mode, provider, benchmarks } = deps;
  const live = mode === 'openrouter';
  const delays = deps.mockDelays ?? DEFAULT_MOCK_DELAYS;
  const elapsed = stopwatch();

  // 1. Understand the prompt
  let classification;
  if (live) {
    classification = await classifyWithAi(provider, deps.routerModel, message, signal);
  } else {
    await sleep(randomBetween(delays.classify), signal);
    classification = classifyByRules(message);
  }
  const classifyMs = elapsed();
  const { category } = classification;

  // 2–3. Compare benchmarks and pick the highest effective score
  const ranking = rankModels(benchmarks, category, deps.learned);
  const selectedModel = ranking[0].model;

  // A model OpenRouter can't run (DALL·E) is stood in for by the best-ranked model it can.
  let answerer = selectedModel;
  if (live && !benchmarks.models[selectedModel].openrouterId) {
    answerer = ranking.find((r) => benchmarks.models[r.model].openrouterId)?.model ?? '';
    if (!answerer) {
      throw new ProviderError(
        'model_unavailable',
        `No model for "${benchmarks.categories[category].label}" has an openrouterId in server/data/benchmarks.json.`,
        503,
      );
    }
  }

  // 4. Answer
  const messages: ChatMessage[] = [
    { role: 'system', content: ANSWER_INSTRUCTIONS },
    ...(category === 'image' ? [{ role: 'system' as const, content: IMAGE_INSTRUCTIONS }] : []),
    ...history,
    { role: 'user', content: message },
  ];
  const modelId = benchmarks.models[answerer].openrouterId ?? answerer;
  let answer = await provider.complete(modelId, messages, { signal });
  if (category === 'image') answer = `${answer}\n\n${IMAGE_NOTE}`;
  const answerMs = elapsed();

  // 5. Quality check
  let quality: Quality;
  if (live) {
    quality = await judgeWithAi(provider, deps.routerModel, message, answer, signal);
  } else {
    await sleep(randomBetween(delays.judge), signal);
    quality = judgeByRules(answer);
  }
  const judgeMs = elapsed();

  return {
    id: `msg_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    routing: {
      category,
      categoryLabel: benchmarks.categories[category].label,
      confidence: classification.confidence,
      language: classification.language,
      reason: classification.reason,
      classifiedBy: classification.by,
      selectedModel,
      ranking,
    },
    answer,
    quality,
    mode,
    ...(answerer !== selectedModel ? { answeredBy: answerer } : {}),
    timings: { classifyMs, answerMs, judgeMs },
  };
}

/** Each call returns the whole milliseconds since the previous call. */
function stopwatch(): () => number {
  let last = performance.now();
  return () => {
    const now = performance.now();
    const ms = Math.round(now - last);
    last = now;
    return ms;
  };
}
