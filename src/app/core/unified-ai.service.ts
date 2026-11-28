import { Injectable } from '@angular/core';
import {
  BENCHMARKS_DATA,
  CATEGORY_IDS,
  isCategory,
  type Category,
} from './engine/catalog';
import { runChat, type Mode } from './engine/chat';
import { GeminiProvider } from './engine/gemini.provider';
import { BrowserLearnedStore, BrowserStats, VOTE_DELTA } from './engine/learning';
import { MockProvider } from './engine/mock.provider';
import { ProviderError } from './engine/provider';
import { rankModels, type RankedModel } from './engine/router';
import { DEFAULT_GEMINI_API_KEY, GEMINI_MODEL } from './gemini.config';

export type { Mode, RankedModel };

export interface Health {
  status: 'ok';
  mode: Mode;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface Routing {
  category: string;
  categoryLabel: string;
  confidence: number;
  language: string;
  reason: string;
  /** "rules" = keyword rules (mock mode or fallback), "ai" = the Gemini AI router. */
  classifiedBy: 'rules' | 'ai';
  selectedModel: string;
  ranking: RankedModel[];
}

export interface ChatResponse {
  id: string;
  routing: Routing;
  answer: string;
  quality: { score: number; verdict: string };
  mode: Mode;
  /** Set when another model answered in place of the selected one (e.g. Gemini for DALL·E). */
  answeredBy?: string;
  timings: { classifyMs: number; answerMs: number; judgeMs: number };
}

export interface FeedbackRequest {
  messageId: string;
  category: string;
  model: string;
  vote: 1 | -1;
}

export interface FeedbackResult {
  category: string;
  model: string;
  before: number;
  after: number;
  learnedAdjustment: number;
}

export interface ModelInfo {
  name: string;
  color: string;
  costTier: number;
  openrouterId: string | null;
}

export interface CategoryBenchmarks {
  label: string;
  short: string;
  /** Base scores from benchmarks.json. */
  scores: Record<string, number>;
  /** Base + learned adjustment. */
  effective: Record<string, number>;
  /** Non-zero learned adjustments only. */
  adjustments: Record<string, number>;
  /** The model the router would pick right now. */
  best: string;
  ranking: RankedModel[];
}

export interface Benchmarks {
  models: Record<string, ModelInfo>;
  categories: Record<string, CategoryBenchmarks>;
  source: string;
}

export interface Stats {
  totalRouted: number;
  byModel: Record<string, number>;
  avgQuality: number | null;
  feedbackCount: number;
}

/** An error from the Unified AI pipeline, with a machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const API_KEY_STORAGE = 'unified_ai_gemini_key';
const MAX_HISTORY_TURNS = 20;
const MAX_REMEMBERED_MESSAGES = 2_000;

function readSavedKey(): string {
  try {
    return typeof localStorage !== 'undefined'
      ? (localStorage.getItem(API_KEY_STORAGE) ?? '').trim()
      : '';
  } catch {
    return '';
  }
}

function saveKey(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    // Ignore storage restriction errors; key remains in memory for this session.
  }
}

/**
 * Runs the entire Unified AI pipeline directly in the browser (no backend server required).
 * Uses the Gemini API when a key is provided (acting as the unified multi-model router),
 * and falls back to offline Demo mode otherwise.
 */
@Injectable({ providedIn: 'root' })
export class UnifiedAiService {
  readonly #learned = new BrowserLearnedStore();
  readonly #stats = new BrowserStats();
  readonly #mockProvider = new MockProvider();
  readonly #routed = new Map<string, { category: Category; model: string; voted: boolean }>();
  #customKey = readSavedKey();

  private activeApiKey(): string {
    return this.#customKey || DEFAULT_GEMINI_API_KEY.trim();
  }

  currentMode(): Mode {
    return this.activeApiKey() ? 'gemini' : 'mock';
  }

  hasCustomApiKey(): boolean {
    return Boolean(this.#customKey);
  }

  setApiKey(rawKey: string): Mode {
    this.#customKey = rawKey.trim();
    saveKey(this.#customKey);
    return this.currentMode();
  }

  clearApiKey(): Mode {
    this.#customKey = '';
    saveKey('');
    return this.currentMode();
  }

  async health(): Promise<Health> {
    return { status: 'ok', mode: this.currentMode() };
  }

  /** Runs the full pipeline (classify → route → answer → judge) in the browser. */
  async chat(message: string, history: ChatTurn[], signal?: AbortSignal): Promise<ChatResponse> {
    const trimmed = message.trim();
    if (!trimmed) throw new ApiError('bad_request', 'Send a non-empty message.');

    const recentHistory = history
      .filter((t) => (t.role === 'user' || t.role === 'assistant') && t.content.trim())
      .slice(-MAX_HISTORY_TURNS);
    const firstUser = recentHistory.findIndex((t) => t.role === 'user');
    const cleanHistory = firstUser < 0 ? [] : recentHistory.slice(firstUser);

    const apiKey = this.activeApiKey();
    const mode: Mode = apiKey ? 'gemini' : 'mock';
    const provider = apiKey ? new GeminiProvider({ apiKey }) : this.#mockProvider;

    try {
      const result = await runChat(
        {
          mode,
          provider,
          geminiModel: GEMINI_MODEL,
          benchmarks: BENCHMARKS_DATA,
          learned: this.#learned,
        },
        trimmed,
        cleanHistory,
        signal,
      );
      this.#stats.recordChat(result.routing.selectedModel, result.quality.score);
      this.remember(result.id, result.routing.category, result.routing.selectedModel);
      return result;
    } catch (err) {
      if ((err as Error).name === 'AbortError' || signal?.aborted) throw err;
      if (err instanceof ProviderError) throw new ApiError(err.code, err.message);
      throw new ApiError('internal', (err as Error).message || 'Unexpected error.');
    }
  }

  async feedback(request: FeedbackRequest): Promise<FeedbackResult> {
    const known = this.#routed.get(request.messageId);
    if (known?.voted) {
      throw new ApiError('already_voted', 'This answer already has a vote.');
    }
    const cat = known?.category ?? request.category;
    const mdl = known?.model ?? request.model;
    if (
      !isCategory(cat) ||
      typeof mdl !== 'string' ||
      BENCHMARKS_DATA.categories[cat].scores[mdl] === undefined
    ) {
      throw new ApiError('bad_request', 'Unknown category, or that model has no score for it.');
    }

    const base = BENCHMARKS_DATA.categories[cat].scores[mdl];
    const { before, after, adjustment } = this.#learned.apply(
      cat,
      mdl,
      request.vote > 0 ? VOTE_DELTA.up : VOTE_DELTA.down,
      base,
    );
    if (known) known.voted = true;
    this.#stats.recordFeedback();
    return { category: cat, model: mdl, before, after, learnedAdjustment: adjustment };
  }

  async getBenchmarks(): Promise<Benchmarks> {
    const categories = Object.fromEntries(
      CATEGORY_IDS.map((id) => {
        const { label, short, scores } = BENCHMARKS_DATA.categories[id];
        const ranking = rankModels(BENCHMARKS_DATA, id, this.#learned);
        return [
          id,
          {
            label,
            short,
            scores,
            effective: Object.fromEntries(ranking.map((r) => [r.model, r.score])),
            adjustments: Object.fromEntries(
              ranking.filter((r) => r.learnedAdjustment).map((r) => [r.model, r.learnedAdjustment]),
            ),
            best: ranking[0].model,
            ranking,
          },
        ];
      }),
    );
    return {
      models: BENCHMARKS_DATA.models,
      categories,
      source: BENCHMARKS_DATA.source,
    };
  }

  async getStats(): Promise<Stats> {
    return this.#stats.snapshot();
  }

  async reset(): Promise<{ status: 'ok' }> {
    this.#stats.reset();
    this.#learned.reset();
    this.#routed.clear();
    return { status: 'ok' };
  }

  private remember(id: string, category: Category, model: string): void {
    this.#routed.set(id, { category, model, voted: false });
    if (this.#routed.size > MAX_REMEMBERED_MESSAGES) {
      this.#routed.delete(this.#routed.keys().next().value!);
    }
  }
}
