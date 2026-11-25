import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isCategory, type Category } from '../catalog.ts';
import { clamp, describeError } from '../util.ts';
import type { AdjustmentSource } from './router.ts';

export type Adjustments = Partial<Record<Category, Record<string, number>>>;

/** 👍 and 👎 change a model's score for one category by these amounts. */
export const VOTE_DELTA = { up: 1, down: -2 } as const;

/** Learned score adjustments, kept in memory and saved to learned.json so they survive restarts. */
export class LearnedStore implements AdjustmentSource {
  readonly #file: string | null;
  #data: Adjustments = {};

  /** Pass null to keep adjustments in memory only (tests). */
  constructor(file: string | null) {
    this.#file = file;
    if (file && existsSync(file)) {
      try {
        this.#data = sanitize(JSON.parse(readFileSync(file, 'utf8')));
      } catch (err) {
        console.warn(`[learning] Couldn't read ${file}, starting from zero. ${describeError(err)}`);
      }
    }
  }

  get(category: Category, model: string): number {
    return this.#data[category]?.[model] ?? 0;
  }

  snapshot(): Adjustments {
    return structuredClone(this.#data);
  }

  /**
   * Adds `delta` to the model's adjustment, keeping its effective score within 0–100.
   * Returns the effective score before and after.
   */
  apply(category: Category, model: string, delta: number, baseScore: number) {
    const current = this.get(category, model);
    const next = clamp(current + delta, -baseScore, 100 - baseScore);
    const row = (this.#data[category] ??= {});
    if (next === 0) delete row[model];
    else row[model] = next;
    if (Object.keys(row).length === 0) delete this.#data[category];
    this.#save();
    return {
      before: clamp(baseScore + current, 0, 100),
      after: baseScore + next,
      adjustment: next,
    };
  }

  reset(): void {
    this.#data = {};
    this.#save();
  }

  #save(): void {
    if (!this.#file) return;
    try {
      // Write a temporary file first so a crash mid-write can't leave broken JSON behind.
      const tmp = `${this.#file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.#data, null, 2) + '\n');
      renameSync(tmp, this.#file);
    } catch (err) {
      console.warn(
        `[learning] Couldn't save ${this.#file}; adjustments are kept in memory only. ${describeError(err)}`,
      );
    }
  }
}

/** Keeps only { category: { model: number } } entries. */
function sanitize(raw: unknown): Adjustments {
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
