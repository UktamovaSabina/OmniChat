import { TestBed } from '@angular/core/testing';
import { ChatStore, type BotTurn } from './chat-store';
import { ApiError, OmniChatApi, type ChatTurn, type Classification, type StreamEvent } from './omnichat-api';
import type { Category } from './routing';

class FakeApi {
  classifyResult: Classification | ApiError = { category: 'coding', reason: 'It is code.' };
  events: StreamEvent[] = [];
  sent: { messages: ChatTurn[]; category: Category }[] = [];

  async classify(): Promise<Classification> {
    if (this.classifyResult instanceof ApiError) throw this.classifyResult;
    return this.classifyResult;
  }

  async *streamChat(messages: ChatTurn[], category: Category): AsyncGenerator<StreamEvent> {
    this.sent.push({ messages: [...messages], category });
    for (const e of this.events) yield e;
  }
}

describe('ChatStore', () => {
  let store: ChatStore;
  let api: FakeApi;

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({ providers: [{ provide: OmniChatApi, useValue: api }] });
    store = TestBed.inject(ChatStore);
  });

  const lastBot = () => store.turns().at(-1) as BotTurn;

  it('routes with the AI classifier and streams the answer', async () => {
    api.events = [
      { type: 'text', delta: 'Add a ' },
      { type: 'text', delta: 'colon.' },
      { type: 'done', model: 'claude-opus-5-5', stopReason: 'end_turn' },
    ];
    await store.submit('fix my python');

    const bot = lastBot();
    expect(bot.route()).toMatchObject({ category: 'coding', winner: 'claude', by: 'ai' });
    expect(bot.status()).toBe('done');
    expect(bot.text()).toBe('Add a colon.');
    expect(bot.note()).toBe(''); // Claude was the router's pick, so no stand-in note
    expect(store.total()).toBe(1);
    expect(store.busy()).toBe(false);
  });

  it('notes when Claude stands in for another model and keeps history', async () => {
    api.classifyResult = { category: 'math', reason: 'An equation.' };
    api.events = [
      { type: 'text', delta: 'x = 2' },
      { type: 'done', model: 'claude-opus-5-5', stopReason: 'end_turn' },
    ];
    await store.submit('2x = 4');
    expect(lastBot().route()?.winner).toBe('chatgpt');
    expect(lastBot().note()).toContain("ChatGPT isn't connected yet");

    await store.submit('and 3x = 9?');
    expect(api.sent[1].messages).toEqual([
      { role: 'user', content: '2x = 4' },
      { role: 'assistant', content: 'x = 2' },
      { role: 'user', content: 'and 3x = 9?' },
    ]);
    expect(store.usageList()).toEqual([{ model: 'chatgpt', count: 2 }]);
  });

  it('falls back to keywords and skips answering when the server has no API key', async () => {
    api.classifyResult = new ApiError('not_configured', 'Set ANTHROPIC_API_KEY.');
    await store.submit('Draw a logo for a coffee shop');

    const bot = lastBot();
    expect(bot.route()).toMatchObject({ category: 'image', winner: 'dalle', by: 'keywords' });
    expect(bot.status()).toBe('error');
    expect(bot.error()).toBe('The router picked DALL·E. Set ANTHROPIC_API_KEY.');
    expect(api.sent).toHaveLength(0);
  });

  it('still answers when only the classifier fails', async () => {
    api.classifyResult = new ApiError('unclassified', 'No usable answer.');
    api.events = [{ type: 'text', delta: 'Hi' }, { type: 'done', model: 'm', stopReason: 'end_turn' }];
    await store.submit('hello there');
    expect(lastBot().route()?.by).toBe('keywords');
    expect(lastBot().text()).toBe('Hi');
  });

  it('shows a stream error and leaves it out of history', async () => {
    api.events = [
      { type: 'text', delta: 'partial' },
      { type: 'error', code: 'refusal', message: 'The model declined to answer this request.' },
    ];
    await store.submit('fix my code');
    expect(lastBot().status()).toBe('error');
    expect(lastBot().text()).toBe('');
    expect(lastBot().error()).toBe('The model declined to answer this request.');

    api.events = [{ type: 'done', model: 'm', stopReason: 'end_turn' }];
    await store.submit('next');
    expect(api.sent[1].messages).toEqual([{ role: 'user', content: 'next' }]);
  });

  it('ignores blank input', async () => {
    await store.submit('   ');
    expect(store.turns()).toEqual([]);
  });
});
