import type { BenchmarksData, Category } from './catalog';
import { classifyByRules, classifyWithAi } from './classifier';
import { judgeByRules, judgeWithAi, type Quality } from './judge';
import type { BrowserLearnedStore } from './learning';
import type { AiProvider, ChatMessage } from './provider';
import { rankModels, type RankedModel } from './router';
import { randomBetween, sleep } from './util';

export type Mode = 'mock' | 'gemini';

export const ANSWER_INSTRUCTIONS =
  "You are answering inside Unified AI, a multi-model router. Answer helpfully and concisely in Markdown, in the user's language.";

export const IMAGE_INSTRUCTIONS =
  "The user wants an image, but no image renderer is connected yet. Write one vivid, ready-to-use image prompt in English inside a ```text code block, then add two or three short design notes in the user's language.";

export const IMAGE_NOTE = '_Image generation preview — connect an image model to render._';

const MODEL_PERSONAS: Record<string, string> = {
  claude:
    'You have been selected by the Unified AI router as Claude (chosen for clear, thoughtful structure, coding precision, and natural writing).',
  chatgpt:
    'You have been selected by the Unified AI router as ChatGPT (chosen for step-by-step analytical reasoning and balanced, clear explanations).',
  gemini:
    'You have been selected by the Unified AI router as Gemini (chosen for multilingual fluency, translation nuance, and broad versatility).',
  perplexity:
    'You have been selected by the Unified AI router as Perplexity (chosen for structured research briefings; note clearly when live web access is unavailable).',
  dalle:
    'You have been selected as the prompt specialist standing in for DALL·E to craft a detailed image prompt.',
};

export interface PipelineDeps {
  mode: Mode;
  provider: AiProvider;
  geminiModel: string;
  benchmarks: BenchmarksData;
  learned: BrowserLearnedStore;
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
    classifiedBy: 'rules' | 'ai';
    selectedModel: string;
    ranking: RankedModel[];
  };
  answer: string;
  quality: Quality;
  mode: Mode;
  answeredBy?: string;
  timings: { classifyMs: number; answerMs: number; judgeMs: number };
}

const DEFAULT_MOCK_DELAYS = { classify: [200, 400], judge: [150, 320] } as const;

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `msg_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  }
  return `msg_${Math.random().toString(36).slice(2, 14)}`;
}

/** Classify → compare benchmarks → pick the best model → answer via Gemini/mock → quality check. */
export async function runChat(
  deps: PipelineDeps,
  message: string,
  history: ChatMessage[],
  signal?: AbortSignal,
): Promise<ChatResult> {
  const { mode, provider, benchmarks } = deps;
  const live = mode === 'gemini';
  const delays = deps.mockDelays ?? DEFAULT_MOCK_DELAYS;
  const elapsed = stopwatch();

  // 1. Understand the prompt
  let classification;
  if (live) {
    classification = await classifyWithAi(provider, deps.geminiModel, message, signal);
  } else {
    await sleep(randomBetween(delays.classify), signal);
    classification = classifyByRules(message);
  }
  const classifyMs = elapsed();
  const { category } = classification;

  // 2–3. Compare benchmarks and pick the highest effective score
  const ranking = rankModels(benchmarks, category, deps.learned);
  const selectedModel = ranking[0].model;

  // When DALL·E is picked in live Gemini mode, Gemini stands in to write the image prompt.
  const answerer = live && selectedModel === 'dalle' ? 'gemini' : selectedModel;

  // 4. Answer (Gemini acts as the routed model so the multi-model router works with one API key)
  const persona = MODEL_PERSONAS[selectedModel] ?? '';
  const messages: ChatMessage[] = [
    { role: 'system', content: persona ? `${ANSWER_INSTRUCTIONS}\n${persona}` : ANSWER_INSTRUCTIONS },
    ...(category === 'image' ? [{ role: 'system' as const, content: IMAGE_INSTRUCTIONS }] : []),
    ...history,
    { role: 'user', content: message },
  ];

  let answer = await provider.complete(deps.geminiModel, messages, { signal });
  if (category === 'image') answer = `${answer}\n\n${IMAGE_NOTE}`;
  const answerMs = elapsed();

  // 5. Quality check
  let quality: Quality;
  if (live) {
    quality = await judgeWithAi(provider, deps.geminiModel, message, answer, signal);
  } else {
    await sleep(randomBetween(delays.judge), signal);
    quality = judgeByRules(answer);
  }
  const judgeMs = elapsed();

  return {
    id: makeId(),
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

function stopwatch(): () => number {
  let last = performance.now();
  return () => {
    const now = performance.now();
    const ms = Math.round(now - last);
    last = now;
    return ms;
  };
}
