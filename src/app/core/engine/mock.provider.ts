import rawAnswers from '../../../../server/data/mock-answers.json';
import type { Category } from './catalog';
import { classifyByRules } from './classifier';
import type { AiProvider, ChatMessage, CompleteOptions } from './provider';
import { randomBetween, sleep } from './util';

type Text = string | string[];

interface MockAnswers {
  prompts: { prompt: string; answer: Text }[];
  notes: Record<string, Text>;
  templates: Record<Category, Record<string, Text>>;
}

const LANGUAGES = ['English', 'Uzbek', 'Russian'];
const join = (text: Text): string => (Array.isArray(text) ? text.join('\n') : text);

function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[‘’ʻʼ`]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[·⋅×*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '');
}

function quotable(prompt: string): string {
  const line = prompt.replace(/`{3,}/g, '').replace(/\s+/g, ' ').trim();
  return line.length > 240 ? `${line.slice(0, 239)}…` : line;
}

const DEMO_NOTES: Record<string, string> = {
  English: '_Demo mode: this is a canned answer. Add a Gemini API key in the header for live AI answers._',
  Uzbek:
    "_Demo rejimi: bu tayyor javob. Jonli AI javoblari uchun yuqorida Gemini API kalitini kiriting._",
  Russian:
    '_Демо-режим: это заготовленный ответ. Для живых ответов укажите ключ Gemini API в шапке._',
};

/**
 * Simulated provider for offline/zero-key demo mode: no network calls.
 */
export class MockProvider implements AiProvider {
  readonly #exact = new Map<string, string>();
  readonly #data: MockAnswers;
  readonly #delay: readonly [number, number];

  constructor(options: { delayMs?: readonly [number, number] } = {}) {
    this.#data = rawAnswers as MockAnswers;
    this.#delay = options.delayMs ?? [600, 1200];
    for (const { prompt, answer } of this.#data.prompts) {
      this.#exact.set(normalizePrompt(prompt), join(answer));
    }
  }

  async complete(
    _modelId: string,
    messages: ChatMessage[],
    options?: CompleteOptions,
  ): Promise<string> {
    await sleep(randomBetween(this.#delay), options?.signal);
    const prompt = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    return this.answerFor(prompt);
  }

  answerFor(prompt: string): string {
    const exact = this.#exact.get(normalizePrompt(prompt));
    if (exact) return exact;

    const { category, language } = classifyByRules(prompt);
    const lang = LANGUAGES.includes(language) ? language : 'English';
    const templates = this.#data.templates[category];
    const note = DEMO_NOTES[lang] ?? DEMO_NOTES['English'];
    return join(templates[lang] ?? templates['English'])
      .replaceAll('{prompt}', quotable(prompt))
      .replaceAll('{note}', note);
  }
}
