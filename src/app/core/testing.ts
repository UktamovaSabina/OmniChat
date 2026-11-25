// Test doubles shared by the specs. Not imported by the app.
import { PIPELINE_TIMING } from './chat-store';
import {
  ApiError,
  type Benchmarks,
  type ChatResponse,
  type ChatTurn,
  type FeedbackRequest,
  type Stats,
} from './unified-ai.service';

export const BENCHMARKS: Benchmarks = {
  models: {
    claude: {
      name: 'Claude',
      color: '#d97757',
      costTier: 2,
      openrouterId: 'anthropic/claude-sonnet-4.5',
    },
    chatgpt: { name: 'ChatGPT', color: '#10a37f', costTier: 2, openrouterId: 'openai/gpt-5' },
  },
  categories: {
    coding: {
      label: 'Coding',
      short: 'Code',
      scores: { claude: 95, chatgpt: 92 },
      effective: { claude: 95, chatgpt: 92 },
      adjustments: {},
      best: 'claude',
      ranking: [
        { model: 'claude', score: 95, baseScore: 95, learnedAdjustment: 0 },
        { model: 'chatgpt', score: 92, baseScore: 92, learnedAdjustment: 0 },
      ],
    },
  },
  source: 'test',
};

export function chatResponse(answer = 'Add a colon after `range(10)`.'): ChatResponse {
  return {
    id: 'msg_1',
    routing: {
      category: 'coding',
      categoryLabel: 'Coding',
      confidence: 96,
      language: 'English',
      reason: 'Contains Python code and asks for a fix.',
      classifiedBy: 'rules',
      selectedModel: 'claude',
      ranking: BENCHMARKS.categories['coding'].ranking,
    },
    answer,
    quality: { score: 91, verdict: 'Accurate and well explained' },
    mode: 'mock',
    timings: { classifyMs: 300, answerMs: 1200, judgeMs: 250 },
  };
}

/** Stands in for UnifiedAiService: records what was sent and answers like the mock-mode server. */
export class FakeApi {
  chatResult: ChatResponse | ApiError = chatResponse();
  feedbackResult: ApiError | null = null;
  sent: { message: string; history: ChatTurn[] }[] = [];
  votes: FeedbackRequest[] = [];
  benchmarkCalls = 0;

  async health() {
    return { status: 'ok' as const, mode: 'mock' as const };
  }
  async chat(message: string, history: ChatTurn[]) {
    this.sent.push({ message, history: [...history] });
    if (this.chatResult instanceof ApiError) throw this.chatResult;
    return this.chatResult;
  }
  async feedback(request: FeedbackRequest) {
    this.votes.push(request);
    if (this.feedbackResult) throw this.feedbackResult;
    return {
      category: request.category,
      model: request.model,
      before: 95,
      after: 96,
      learnedAdjustment: 1,
    };
  }
  async getBenchmarks() {
    this.benchmarkCalls++;
    return BENCHMARKS;
  }
  async getStats(): Promise<Stats> {
    return { totalRouted: 1, byModel: { claude: 1 }, avgQuality: 91, feedbackCount: 0 };
  }
  async reset() {
    return { status: 'ok' as const };
  }
}

/** Turns the pipeline animation off. */
export const NO_DELAYS = {
  provide: PIPELINE_TIMING,
  useValue: { stepMs: 0, catchUpMs: 0, qualityMs: 0, toastMs: 0 },
};
