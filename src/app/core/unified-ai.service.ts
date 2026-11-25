import { Injectable } from '@angular/core';

export type Mode = 'mock' | 'openrouter';

export interface Health {
  status: 'ok';
  mode: Mode;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface RankedModel {
  model: string;
  /** Effective score: base benchmark score + learned adjustment. */
  score: number;
  baseScore: number;
  learnedAdjustment: number;
}

export interface Routing {
  category: string;
  categoryLabel: string;
  confidence: number;
  language: string;
  reason: string;
  /** "rules" = keyword rules (mock mode or fallback), "ai" = the AI router. */
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
  /** Set when another model answered in place of the selected one (e.g. a text model for DALL·E). */
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

/** An error from the Unified AI server, with a machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const OFFLINE_MESSAGE = "Can't reach the Unified AI server. Start it with `npm start`.";

/**
 * Talks to the Unified AI Node server (server/index.ts). In development, /api is
 * proxied there by proxy.conf.json, so API keys never reach the browser.
 */
@Injectable({ providedIn: 'root' })
export class UnifiedAiService {
  health(): Promise<Health> {
    return this.request('/api/health');
  }

  /** Runs the whole pipeline (classify → route → answer → judge) and returns everything at once. */
  chat(message: string, history: ChatTurn[], signal?: AbortSignal): Promise<ChatResponse> {
    return this.request('/api/chat', { message, history }, signal);
  }

  feedback(request: FeedbackRequest): Promise<FeedbackResult> {
    return this.request('/api/feedback', request);
  }

  getBenchmarks(): Promise<Benchmarks> {
    return this.request('/api/benchmarks');
  }

  getStats(): Promise<Stats> {
    return this.request('/api/stats');
  }

  /** Clears stats and learned adjustments on the server. */
  reset(): Promise<{ status: 'ok' }> {
    return this.request('/api/reset', {});
  }

  /** GET without a body, POST with one. Throws ApiError, or the AbortError when `signal` aborts. */
  private async request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetch(
        url,
        body === undefined
          ? { signal }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal,
            },
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ApiError('offline', OFFLINE_MESSAGE);
    }

    const data = (await res.json().catch(() => null)) as
      (T & { code?: string; message?: string }) | null;
    if (res.ok && data) return data;
    if (data?.code) throw new ApiError(data.code, data.message ?? 'Request failed.');
    // No JSON error body: usually the dev-server proxy reporting that the API server is down.
    throw new ApiError('offline', OFFLINE_MESSAGE);
  }
}
