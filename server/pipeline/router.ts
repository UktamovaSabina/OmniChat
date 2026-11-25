import type { Benchmarks, Category } from '../catalog.ts';
import { clamp } from '../util.ts';

export interface RankedModel {
  model: string;
  /** Effective score: base benchmark score + learned adjustment, clamped to 0–100. */
  score: number;
  baseScore: number;
  learnedAdjustment: number;
}

export interface AdjustmentSource {
  get(category: Category, model: string): number;
}

/**
 * Ranks every model that has a score for the category, best first.
 * Highest effective score wins; on a tie the lower costTier wins; if still tied, the model listed
 * first in that category's "scores" keeps its place (the sort is stable).
 */
export function rankModels(
  benchmarks: Benchmarks,
  category: Category,
  learned: AdjustmentSource,
): RankedModel[] {
  return Object.entries(benchmarks.categories[category].scores)
    .map(([model, baseScore]) => {
      const learnedAdjustment = learned.get(category, model);
      return {
        model,
        score: clamp(baseScore + learnedAdjustment, 0, 100),
        baseScore,
        learnedAdjustment,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        benchmarks.models[a.model].costTier - benchmarks.models[b.model].costTier,
    );
}
