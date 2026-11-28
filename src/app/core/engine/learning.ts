import { isCategory, type Category } from './catalog';
import type { AdjustmentSource } from './router';
import { clamp } from './util';

export type Adjustments = Partial<Record<Category, Record<string, number>>>;

export const VOTE_DELTA = { up: 1, down: -2 } as const;

export interface StatsSnapshot {
  totalRouted: number;
  byModel: Record<string, number>;
  avgQuality: number | null;
  feedbackCount: number;
}

const LEARNED_KEY = 'unified_ai_learned_v1';
const STATS_KEY = 'unified_ai_stats_v1';

interface StoredStats {
  totalRouted: number;
  byModel: Record<string, number>;
  qualitySum: number;
  qualityCount: number;
  feedbackCount: number;
}

function readStorage(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota / privacy mode failures; state still lives in memory.
  }
}

/** Learned score adjustments stored in browser localStorage. */
export class BrowserLearnedStore implements AdjustmentSource {
  #data: Adjustments = {};

  constructor() {
    const raw = readStorage(LEARNED_KEY);
    if (raw) {
      try {
        this.#data = sanitizeAdjustments(JSON.parse(raw));
      } catch {
        this.#data = {};
      }
    }
  }

  get(category: Category, model: string): number {
    return this.#data[category]?.[model] ?? 0;
  }

  apply(category: Category, model: string, delta: number, baseScore: number) {
    const current = this.get(category, model);
    const next = clamp(current + delta, -baseScore, 100 - baseScore);
    const row = (this.#data[category] ??= {});
    if (next === 0) delete row[model];
    else row[model] = next;
    if (Object.keys(row).length === 0) delete this.#data[category];
    writeStorage(LEARNED_KEY, JSON.stringify(this.#data));
    return {
      before: clamp(baseScore + current, 0, 100),
      after: baseScore + next,
      adjustment: next,
    };
  }

  reset(): void {
    this.#data = {};
    writeStorage(LEARNED_KEY, '{}');
  }
}

/** Session statistics persisted in browser localStorage. */
export class BrowserStats {
  #state: StoredStats = {
    totalRouted: 0,
    byModel: {},
    qualitySum: 0,
    qualityCount: 0,
    feedbackCount: 0,
  };

  constructor() {
    const raw = readStorage(STATS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<StoredStats>;
        if (parsed && typeof parsed === 'object') {
          this.#state = {
            totalRouted: Number(parsed.totalRouted) || 0,
            byModel:
              parsed.byModel && typeof parsed.byModel === 'object' ? { ...parsed.byModel } : {},
            qualitySum: Number(parsed.qualitySum) || 0,
            qualityCount: Number(parsed.qualityCount) || 0,
            feedbackCount: Number(parsed.feedbackCount) || 0,
          };
        }
      } catch {
        // Use clean defaults if stored JSON is corrupt.
      }
    }
  }

  recordChat(model: string, qualityScore: number): void {
    this.#state.totalRouted++;
    this.#state.byModel[model] = (this.#state.byModel[model] ?? 0) + 1;
    this.#state.qualitySum += qualityScore;
    this.#state.qualityCount++;
    writeStorage(STATS_KEY, JSON.stringify(this.#state));
  }

  recordFeedback(): void {
    this.#state.feedbackCount++;
    writeStorage(STATS_KEY, JSON.stringify(this.#state));
  }

  reset(): void {
    this.#state = {
      totalRouted: 0,
      byModel: {},
      qualitySum: 0,
      qualityCount: 0,
      feedbackCount: 0,
    };
    writeStorage(STATS_KEY, JSON.stringify(this.#state));
  }

  snapshot(): StatsSnapshot {
    return {
      totalRouted: this.#state.totalRouted,
      byModel: { ...this.#state.byModel },
      avgQuality: this.#state.qualityCount
        ? Math.round(this.#state.qualitySum / this.#state.qualityCount)
        : null,
      feedbackCount: this.#state.feedbackCount,
    };
  }
}

function sanitizeAdjustments(raw: unknown): Adjustments {
  const out: Adjustments = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [category, row] of Object.entries(raw)) {
    if (!isCategory(category) || !row || typeof row !== 'object') continue;
    for (const [model, value] of Object.entries(row)) {
      if (typeof value === 'number' && Number.isFinite(value) && value !== 0)
        (out[category] ??= {})[model] = value;
    }
  }
  return out;
}
