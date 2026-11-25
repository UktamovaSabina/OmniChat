import {
  Injectable,
  InjectionToken,
  computed,
  inject,
  signal,
  type WritableSignal,
} from '@angular/core';
import { STEP } from './copy';
import {
  ApiError,
  UnifiedAiService,
  type Benchmarks,
  type ChatResponse,
  type ChatTurn,
  type Mode,
  type Routing,
  type Stats,
} from './unified-ai.service';

/** Animation timings (ms). Tests set them to 0. */
export interface PipelineTiming {
  /** Each of the first three steps while the request is in flight. */
  stepMs: number;
  /** Each remaining step when the answer arrives before the steps have played out. */
  catchUpMs: number;
  /** The quality-check step, after the answer appears. */
  qualityMs: number;
  toastMs: number;
}

export const PIPELINE_TIMING = new InjectionToken<PipelineTiming>('PIPELINE_TIMING', {
  factory: () => ({ stepMs: 400, catchUpMs: 120, qualityMs: 350, toastMs: 2600 }),
});

export interface UserTurn {
  kind: 'user';
  id: number;
  text: string;
}

export type BotStatus = 'pending' | 'done' | 'error' | 'stopped';

export interface BotTurn {
  kind: 'bot';
  id: number;
  /** Index of the active pipeline step (0–4); STEP.done (5) once every step is done. */
  step: WritableSignal<number>;
  status: WritableSignal<BotStatus>;
  result: WritableSignal<ChatResponse | null>;
  error: WritableSignal<string>;
  vote: WritableSignal<1 | -1 | null>;
}

export type Turn = UserTurn | BotTurn;

export interface Decision {
  turnId: number;
  routing: Routing;
  timings: ChatResponse['timings'];
}

export interface Toast {
  id: number;
  text: string;
  visible: boolean;
}

const MAX_HISTORY = 20;
const UNKNOWN_MODEL = { name: '', color: 'var(--muted)' };

/** Conversation state plus the data behind the side panel (benchmarks, stats, last decision). */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly api = inject(UnifiedAiService);
  private readonly timing = inject(PIPELINE_TIMING);
  private nextId = 1;
  /** Completed exchanges, sent to the server as conversation context. */
  private readonly history: ChatTurn[] = [];
  private abort?: AbortController;
  private toastTimer?: ReturnType<typeof setTimeout>;

  readonly turns = signal<Turn[]>([]);
  readonly busy = signal(false);
  /** Null until the server has answered. */
  readonly mode = signal<Mode | null>(null);
  readonly benchmarks = signal<Benchmarks | null>(null);
  readonly stats = signal<Stats | null>(null);
  readonly lastDecision = signal<Decision | null>(null);
  readonly toast = signal<Toast | null>(null);

  private readonly models = computed(() => this.benchmarks()?.models ?? {});

  constructor() {
    this.api.health().then(
      (h) => this.mode.set(h.mode),
      () => {}, // server not up yet; the first chat will report it
    );
    void this.refreshInsights();
  }

  /** Display name and colour for a model id, from benchmarks.json. */
  model(id: string): { name: string; color: string } {
    return this.models()[id] ?? { ...UNKNOWN_MODEL, name: id };
  }

  async submit(raw: string): Promise<void> {
    const question = raw.trim();
    if (!question || this.busy()) return;
    this.busy.set(true);

    const bot: BotTurn = {
      kind: 'bot',
      id: this.nextId++,
      step: signal(0),
      status: signal('pending'),
      result: signal(null),
      error: signal(''),
      vote: signal(null),
    };
    this.turns.update((t) => [...t, { kind: 'user', id: this.nextId++, text: question }, bot]);
    this.abort = new AbortController();

    // The server answers all at once, so the first steps are animated while the request is in flight.
    const ticker = setInterval(
      () => bot.step.update((s) => Math.min(s + 1, STEP.answering)),
      this.timing.stepMs,
    );
    try {
      const result = await this.api.chat(
        question,
        this.history.slice(-MAX_HISTORY),
        this.abort.signal,
      );
      clearInterval(ticker);
      while (bot.step() < STEP.answering) {
        await wait(this.timing.catchUpMs);
        bot.step.update((s) => s + 1);
      }

      bot.result.set(result);
      bot.step.set(STEP.quality);
      this.mode.set(result.mode);
      this.lastDecision.set({ turnId: bot.id, routing: result.routing, timings: result.timings });
      this.history.push(
        { role: 'user', content: question },
        { role: 'assistant', content: result.answer },
      );
      void this.refreshInsights();

      await wait(this.timing.qualityMs);
      bot.step.set(STEP.done);
      bot.status.set('done');
    } catch (err) {
      clearInterval(ticker);
      if ((err as Error).name === 'AbortError') {
        bot.status.set('stopped');
        bot.error.set('Stopped before the answer arrived.');
      } else {
        bot.status.set('error');
        bot.error.set(
          err instanceof ApiError ? err.message : `Something went wrong: ${(err as Error).message}`,
        );
      }
    } finally {
      this.busy.set(false);
      this.abort = undefined;
    }
  }

  /** Cancels the request that is in flight. */
  stop(): void {
    this.abort?.abort();
  }

  /** 👍 (1) or 👎 (-1) on an answer: the router adjusts that model's score for the category. */
  async vote(turn: BotTurn, vote: 1 | -1): Promise<void> {
    const result = turn.result();
    if (!result || turn.vote() !== null) return;
    turn.vote.set(vote);
    const { category, selectedModel, categoryLabel } = result.routing;
    try {
      const r = await this.api.feedback({
        messageId: result.id,
        category,
        model: selectedModel,
        vote,
      });
      this.showToast(
        `Router learned: ${this.model(r.model).name} · ${categoryLabel} ${r.before} → ${r.after}`,
      );
      void this.refreshInsights();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'already_voted') return;
      turn.vote.set(null);
      this.showToast(
        `Couldn't send feedback. ${err instanceof ApiError ? err.message : ''}`.trim(),
      );
    }
  }

  /** Clears the server's stats and learned adjustments (handy before a live demo). */
  async resetLearning(): Promise<void> {
    try {
      await this.api.reset();
      this.showToast('Stats and learned scores were reset.');
    } catch (err) {
      this.showToast(err instanceof ApiError ? err.message : "Couldn't reset.");
    }
    await this.refreshInsights();
  }

  /** Reloads the benchmark table and stats; keeps the old values if the server can't be reached. */
  async refreshInsights(): Promise<void> {
    const [benchmarks, stats] = await Promise.allSettled([
      this.api.getBenchmarks(),
      this.api.getStats(),
    ]);
    if (benchmarks.status === 'fulfilled') this.benchmarks.set(benchmarks.value);
    if (stats.status === 'fulfilled') this.stats.set(stats.value);
  }

  private showToast(text: string): void {
    const id = (this.toast()?.id ?? 0) + 1;
    this.toast.set({ id, text, visible: true });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(
      () => this.toast.update((t) => (t?.id === id ? { ...t, visible: false } : t)),
      this.timing.toastMs,
    );
  }
}

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
