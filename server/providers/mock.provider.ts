import { CATEGORY_IDS, readJson, type Category } from '../catalog.ts';
import { classifyByRules } from '../pipeline/classifier.ts';
import { randomBetween, sleep } from '../util.ts';
import type { AiProvider, ChatMessage, CompleteOptions } from './provider.ts';

/** An answer in mock-answers.json: one string, or an array of lines. */
type Text = string | string[];

export interface MockAnswers {
  prompts: { prompt: string; answer: Text }[];
  /** The "this is a canned answer" line per language, inserted where a template says {note}. */
  notes: Record<string, Text>;
  /** Fallback answer per category and language. {prompt} becomes the user's message. */
  templates: Record<Category, Record<string, Text>>;
}

const LANGUAGES = ['English', 'Uzbek', 'Russian'];

const join = (text: Text): string => (Array.isArray(text) ? text.join('\n') : text);

/** Ignores case, spacing, curly quotes, multiplication dots and trailing punctuation when matching demo prompts. */
export function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[‘’ʻʼ`]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[·⋅×*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '');
}

/** The user's message on one line, short enough to quote inside a template. */
function quotable(prompt: string): string {
  const line = prompt.replace(/`{3,}/g, '').replace(/\s+/g, ' ').trim();
  return line.length > 240 ? `${line.slice(0, 239)}…` : line;
}

/**
 * Simulated provider for the demo: no network calls. Demo prompts get hand-written answers;
 * anything else gets the template for its category, in the user's language.
 */
export class MockProvider implements AiProvider {
  readonly #exact = new Map<string, string>();
  readonly #data: MockAnswers;
  readonly #delay: readonly [number, number];

  constructor(options: { answers?: MockAnswers; delayMs?: readonly [number, number] } = {}) {
    this.#data = options.answers ?? readJson<MockAnswers>('mock-answers.json');
    this.#delay = options.delayMs ?? [800, 1600];
    for (const { prompt, answer } of this.#data.prompts)
      this.#exact.set(normalizePrompt(prompt), join(answer));
    for (const category of CATEGORY_IDS) {
      if (!this.#data.templates?.[category]?.['English']) {
        throw new Error(`server/data/mock-answers.json: templates.${category}.English is missing.`);
      }
    }
  }

  async complete(
    _modelId: string,
    messages: ChatMessage[],
    options?: CompleteOptions,
  ): Promise<string> {
    await sleep(randomBetween(this.#delay), options?.signal);
    const prompt = messages.findLast((m) => m.role === 'user')?.content ?? '';
    return this.answerFor(prompt);
  }

  answerFor(prompt: string): string {
    const exact = this.#exact.get(normalizePrompt(prompt));
    if (exact) return exact;

    // The pipeline classified this prompt with the same rules, so category and language match the routing row.
    const { category, language } = classifyByRules(prompt);
    const lang = LANGUAGES.includes(language) ? language : 'English';
    const templates = this.#data.templates[category];
    const note = this.#data.notes[lang] ?? this.#data.notes['English'] ?? '';
    return join(templates[lang] ?? templates['English'])
      .replaceAll('{prompt}', quotable(prompt))
      .replaceAll('{note}', join(note));
  }
}
