import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Where the editable JSON files live (benchmarks, canned answers, learned adjustments). */
export const DATA_DIR = path.join(import.meta.dirname, 'data');

/** The task types the classifier knows. benchmarks.json must have a row for each. */
export const CATEGORY_IDS = [
  'coding',
  'math',
  'writing',
  'research',
  'image',
  'translation',
  'general',
] as const;
export type Category = (typeof CATEGORY_IDS)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORY_IDS as readonly string[]).includes(value);
}

export interface ModelInfo {
  name: string;
  /** Model id on OpenRouter; null when the model can't be called there (e.g. image-only models). */
  openrouterId: string | null;
  color: string;
  /** Relative price. Breaks ties between equal scores: the cheaper model wins. */
  costTier: number;
}

export interface CategoryInfo {
  label: string;
  /** Short label for narrow places such as the benchmark table. */
  short: string;
  /** Base benchmark score (0–100) per model id. Models without a score are never picked for this task. */
  scores: Record<string, number>;
}

export interface Benchmarks {
  models: Record<string, ModelInfo>;
  categories: Record<Category, CategoryInfo>;
  source: string;
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf8')) as T;
}

/** Reads benchmarks.json and fails fast, with a clear message, if it has a mistake. */
export function loadBenchmarks(file = 'benchmarks.json'): Benchmarks {
  const raw = readJson<Partial<Benchmarks>>(file);
  const problem = (msg: string) => new Error(`server/data/${file}: ${msg}`);

  const models = raw.models ?? {};
  if (Object.keys(models).length === 0) throw problem('"models" is empty.');
  for (const [id, m] of Object.entries(models)) {
    if (!m.name || !m.color || typeof m.costTier !== 'number') {
      throw problem(`model "${id}" needs "name", "color" and a numeric "costTier".`);
    }
    m.openrouterId ??= null;
  }

  const categories = (raw.categories ?? {}) as Partial<Record<Category, CategoryInfo>>;
  for (const id of CATEGORY_IDS) {
    const c = categories[id];
    if (!c?.label || !c.scores || Object.keys(c.scores).length === 0) {
      throw problem(`category "${id}" needs a "label" and at least one score.`);
    }
    c.short ||= c.label;
    for (const [model, score] of Object.entries(c.scores)) {
      if (!models[model]) throw problem(`category "${id}" scores unknown model "${model}".`);
      if (typeof score !== 'number' || score < 0 || score > 100) {
        throw problem(`score for ${model} in "${id}" must be a number from 0 to 100.`);
      }
    }
  }

  return {
    models,
    categories: categories as Record<Category, CategoryInfo>,
    source: raw.source ?? '',
  };
}
