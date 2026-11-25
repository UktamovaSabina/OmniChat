import { TestBed } from '@angular/core/testing';
import { ChatStore, type BotTurn } from './chat-store';
import { STEP } from './copy';
import { chatResponse, FakeApi, NO_DELAYS } from './testing';
import { ApiError, UnifiedAiService } from './unified-ai.service';

describe('ChatStore', () => {
  let store: ChatStore;
  let api: FakeApi;

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [{ provide: UnifiedAiService, useValue: api }, NO_DELAYS],
    });
    store = TestBed.inject(ChatStore);
  });

  const lastBot = () => store.turns().at(-1) as BotTurn;

  it('runs the pipeline and records the routing decision', async () => {
    const callsBefore = api.benchmarkCalls;
    await store.submit('Fix this Python: for i in range(10) print(i)');

    const bot = lastBot();
    expect(bot.status()).toBe('done');
    expect(bot.step()).toBe(STEP.done);
    expect(bot.result()?.answer).toContain('colon');
    expect(store.lastDecision()?.routing.selectedModel).toBe('claude');
    expect(store.mode()).toBe('mock');
    expect(store.busy()).toBe(false);
    expect(api.benchmarkCalls).toBe(callsBefore + 1); // benchmarks and stats refresh after each answer
  });

  it('sends earlier exchanges as history', async () => {
    await store.submit('first');
    await store.submit('second');
    expect(api.sent[1]).toEqual({
      message: 'second',
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: chatResponse().answer },
      ],
    });
  });

  it('sends one vote per answer and shows what the router learned', async () => {
    await store.submit('fix my code');
    const bot = lastBot();
    await store.vote(bot, 1);
    await store.vote(bot, -1); // ignored: already voted

    expect(api.votes).toEqual([
      { messageId: 'msg_1', category: 'coding', model: 'claude', vote: 1 },
    ]);
    expect(bot.vote()).toBe(1);
    expect(store.toast()?.text).toBe('Router learned: Claude · Coding 95 → 96');
  });

  it('lets the user vote again when sending the vote fails', async () => {
    await store.submit('fix my code');
    api.feedbackResult = new ApiError('offline', "Can't reach the Unified AI server.");
    await store.vote(lastBot(), -1);
    expect(lastBot().vote()).toBeNull();
    expect(store.toast()?.text).toContain("Couldn't send feedback");
  });

  it('shows a server error on the card and keeps it out of history', async () => {
    api.chatResult = new ApiError('rate_limited', 'OpenRouter is rate-limiting requests.');
    await store.submit('fix my code');
    expect(lastBot().status()).toBe('error');
    expect(lastBot().error()).toBe('OpenRouter is rate-limiting requests.');
    expect(lastBot().result()).toBeNull();

    api.chatResult = chatResponse();
    await store.submit('next');
    expect(api.sent[1].history).toEqual([]);
  });

  it('ignores blank input', async () => {
    await store.submit('   ');
    expect(store.turns()).toEqual([]);
  });
});
