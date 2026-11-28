import rawBenchmarks from '../../../../server/data/benchmarks.json';

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

export interface EngineModelInfo {
  name: string;
  openrouterId: string | null;
  color: string;
  costTier: number;
}

export interface CategoryInfo {
  label: string;
  short: string;
  scores: Record<string, number>;
}

export interface BenchmarksData {
  models: Record<string, EngineModelInfo>;
  categories: Record<Category, CategoryInfo>;
  source: string;
}

export const BENCHMARKS_DATA = rawBenchmarks as BenchmarksData;
