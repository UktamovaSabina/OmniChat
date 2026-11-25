export interface StatsSnapshot {
  totalRouted: number;
  /** How many prompts the router sent to each model. */
  byModel: Record<string, number>;
  /** Mean quality score, rounded; null before the first answer. */
  avgQuality: number | null;
  feedbackCount: number;
}

/** Session statistics, in memory only. */
export class Stats {
  #totalRouted = 0;
  #byModel: Record<string, number> = {};
  #qualitySum = 0;
  #qualityCount = 0;
  #feedbackCount = 0;

  recordChat(model: string, qualityScore: number): void {
    this.#totalRouted++;
    this.#byModel[model] = (this.#byModel[model] ?? 0) + 1;
    this.#qualitySum += qualityScore;
    this.#qualityCount++;
  }

  recordFeedback(): void {
    this.#feedbackCount++;
  }

  reset(): void {
    this.#totalRouted = 0;
    this.#byModel = {};
    this.#qualitySum = 0;
    this.#qualityCount = 0;
    this.#feedbackCount = 0;
  }

  snapshot(): StatsSnapshot {
    return {
      totalRouted: this.#totalRouted,
      byModel: { ...this.#byModel },
      avgQuality: this.#qualityCount ? Math.round(this.#qualitySum / this.#qualityCount) : null,
      feedbackCount: this.#feedbackCount,
    };
  }
}
