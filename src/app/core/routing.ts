export type ModelId = 'claude' | 'chatgpt' | 'gemini' | 'perplexity' | 'dalle';
export type Category = 'coding' | 'math' | 'writing' | 'research' | 'image' | 'translation' | 'general';

export interface ModelInfo {
  name: string;
  /** CSS color, defined as a custom property in styles.css */
  color: string;
  /** Relative price; breaks ties between equal scores (cheaper wins). */
  cost: number;
}

export const MODELS: Record<ModelId, ModelInfo> = {
  claude: { name: 'Claude', color: 'var(--claude)', cost: 2 },
  chatgpt: { name: 'ChatGPT', color: 'var(--chatgpt)', cost: 2 },
  gemini: { name: 'Gemini', color: 'var(--gemini)', cost: 1 },
  perplexity: { name: 'Perplexity', color: 'var(--perplexity)', cost: 2 },
  dalle: { name: 'DALL·E', color: 'var(--dalle)', cost: 3 },
};

export interface CategoryInfo {
  label: string;
  scores: Partial<Record<ModelId, number>>;
}

/** Illustrative routing table: replace with real benchmark results. */
export const CATEGORIES: Record<Category, CategoryInfo> = {
  coding: { label: 'Coding', scores: { claude: 95, chatgpt: 91, gemini: 88 } },
  math: { label: 'Math & logic', scores: { chatgpt: 94, gemini: 92, claude: 90 } },
  writing: { label: 'Writing', scores: { claude: 94, chatgpt: 91, gemini: 86 } },
  research: { label: 'Research & current info', scores: { perplexity: 93, gemini: 90, chatgpt: 88 } },
  image: { label: 'Image generation', scores: { dalle: 92, gemini: 90, chatgpt: 87 } },
  translation: { label: 'Translation & languages', scores: { gemini: 92, chatgpt: 90, claude: 89 } },
  general: { label: 'General question', scores: { chatgpt: 90, claude: 90, gemini: 89 } },
};

export const EXAMPLES: readonly string[] = [
  'Fix this Python: for i in range(10) print(i)',
  'Solve the integral of x·e^x dx step by step',
  'Write a short wedding toast for my sister',
  'What are the latest AI news this week?',
  'Draw a logo for a coffee shop in Tashkent',
  'Translate "Good morning, how are you?" into Uzbek',
];

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && Object.hasOwn(CATEGORIES, value);
}

/** Fallback classifier for when the AI classifier is unavailable. */
export function keywordRoute(question: string): Category {
  const s = question.toLowerCase();
  if (/\b(draw|image|picture|logo|illustrat|poster|rasm)|рисун|нарисуй/.test(s)) return 'image';
  if (/\b(translate|translation|tarjima)|переведи|перевод/.test(s)) return 'translation';
  if (/\b(code|python|javascript|bug|function|error|sql|html|css|java)\b/.test(s)) return 'coding';
  if (/\b(solve|integral|equation|derivative|calculate|math|proof)\b|[0-9]\s*[+\-*/^=]/.test(s)) return 'math';
  if (/\b(latest|news|today|this week|current|price|2026)\b/.test(s)) return 'research';
  if (/\b(write|essay|story|poem|toast|email|letter|speech)\b/.test(s)) return 'writing';
  return 'general';
}

export interface RankedModel {
  model: ModelId;
  score: number;
}

/** Ranks the models for a category: highest score first, cheaper model first on a tie. */
export function rankModels(category: Category): RankedModel[] {
  return (Object.entries(CATEGORIES[category].scores) as [ModelId, number][])
    .map(([model, score]) => ({ model, score }))
    .sort((a, b) => b.score - a.score || MODELS[a.model].cost - MODELS[b.model].cost);
}
