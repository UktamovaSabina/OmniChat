import { Injectable, computed, inject, signal, type WritableSignal } from '@angular/core';
import { ApiError, OmniChatApi, type ChatTurn, type Classification } from './omnichat-api';
import { MODELS, isCategory, keywordRoute, rankModels, type Category, type ModelId, type RankedModel } from './routing';

export interface RouteDecision {
  id: number;
  category: Category;
  reason: string;
  by: 'ai' | 'keywords';
  ranked: RankedModel[];
  winner: ModelId;
}

type Classified = Pick<RouteDecision, 'category' | 'reason' | 'by'>;

export interface UserTurn {
  kind: 'user';
  id: number;
  text: string;
}

export type BotStatus = 'routing' | 'answering' | 'done' | 'error';

export interface BotTurn {
  kind: 'bot';
  id: number;
  route: WritableSignal<RouteDecision | null>;
  status: WritableSignal<BotStatus>;
  text: WritableSignal<string>;
  error: WritableSignal<string>;
  note: WritableSignal<string>;
}

export type Turn = UserTurn | BotTurn;

/** Errors that mean no answer can be produced right now, so there's no point asking for one. */
const UNAVAILABLE = new Set(['offline', 'not_configured']);

@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly api = inject(OmniChatApi);
  private nextId = 1;
  /** Completed exchanges, sent to the server as conversation context. */
  private readonly history: ChatTurn[] = [];
  private abort?: AbortController;

  readonly turns = signal<Turn[]>([]);
  readonly busy = signal(false);
  readonly lastDecision = signal<RouteDecision | null>(null);
  readonly usage = signal<Partial<Record<ModelId, number>>>({});

  readonly total = computed(() => Object.values(this.usage()).reduce((sum, n) => sum + (n ?? 0), 0));
  readonly usageList = computed(() =>
    (Object.entries(this.usage()) as [ModelId, number][])
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count),
  );
  readonly savingsText = computed(() => {
    const n = this.usageList().length;
    return n > 1
      ? `You used ${n} different AIs, which would be ${n} separate subscriptions. Here it's one.`
      : 'Every model you use here would otherwise be a separate subscription.';
  });

  async submit(raw: string): Promise<void> {
    const question = raw.trim();
    if (!question || this.busy()) return;
    this.busy.set(true);

    const bot: BotTurn = {
      kind: 'bot',
      id: this.nextId++,
      route: signal(null),
      status: signal('routing'),
      text: signal(''),
      error: signal(''),
      note: signal(''),
    };
    this.turns.update((t) => [...t, { kind: 'user', id: this.nextId++, text: question }, bot]);

    try {
      // 1. Classify, 2. score, 3. route.
      const { info, unavailable } = await this.classify(question);
      const ranked = rankModels(info.category);
      const winner = ranked[0].model;
      const decision: RouteDecision = { id: bot.id, ...info, ranked, winner };
      bot.route.set(decision);
      this.lastDecision.set(decision);
      this.usage.update((u) => ({ ...u, [winner]: (u[winner] ?? 0) + 1 }));

      if (unavailable) {
        bot.status.set('error');
        bot.error.set(`The router picked ${MODELS[winner].name}. ${unavailable.message}`);
        return;
      }
      await this.answer(bot, question, decision);
    } finally {
      this.busy.set(false);
      this.abort = undefined;
    }
  }

  /** Stops the answer that is currently streaming. */
  stop(): void {
    this.abort?.abort();
  }

  /** Asks the AI classifier; falls back to keyword rules when it can't answer. */
  private async classify(question: string): Promise<{ info: Classified; unavailable?: ApiError }> {
    let unavailable: ApiError | undefined;
    try {
      const result: Classification = await this.api.classify(question);
      if (isCategory(result.category)) {
        return { info: { category: result.category, reason: result.reason, by: 'ai' } };
      }
    } catch (err) {
      if (err instanceof ApiError && UNAVAILABLE.has(err.code)) unavailable = err;
    }
    return {
      info: { category: keywordRoute(question), reason: 'Matched keywords in the question.', by: 'keywords' },
      unavailable,
    };
  }

  private async answer(bot: BotTurn, question: string, decision: RouteDecision): Promise<void> {
    bot.status.set('answering');
    this.abort = new AbortController();
    const messages: ChatTurn[] = [...this.history, { role: 'user', content: question }];
    let servedBy = '';
    let stopReason: string | null = null;

    try {
      for await (const event of this.api.streamChat(messages, decision.category, this.abort.signal)) {
        if (event.type === 'text') bot.text.update((t) => t + event.delta);
        else if (event.type === 'done') ({ model: servedBy, stopReason } = event);
        else throw new ApiError(event.code, event.message);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.finish(bot, question, decision, servedBy, 'stopped');
        return;
      }
      bot.text.set(''); // a partial answer cut off by an error isn't worth keeping
      bot.status.set('error');
      bot.error.set(
        err instanceof ApiError ? err.message : `Couldn't get an answer: ${(err as Error).message || 'unknown error'}`,
      );
      return;
    }
    this.finish(bot, question, decision, servedBy, stopReason);
  }

  private finish(bot: BotTurn, question: string, decision: RouteDecision, servedBy: string, stopReason: string | null) {
    const text = bot.text();
    bot.status.set('done');
    if (text) this.history.push({ role: 'user', content: question }, { role: 'assistant', content: text });

    const notes: string[] = [];
    if (decision.winner !== 'claude') {
      const claude = servedBy ? `Claude (${servedBy})` : 'Claude';
      notes.push(`Demo mode: ${MODELS[decision.winner].name} isn't connected yet, so ${claude} answered in its place.`);
    }
    if (stopReason === 'max_tokens') notes.push('The answer hit the length limit and was cut off.');
    if (stopReason === 'stopped') notes.push('Stopped.');
    bot.note.set(notes.join(' '));
  }
}
