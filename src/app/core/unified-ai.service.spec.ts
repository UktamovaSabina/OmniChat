import { GeminiProvider, pickBestGeminiModel } from './engine/gemini.provider';
import { UnifiedAiService } from './unified-ai.service';

describe('UnifiedAiService (serverless browser engine)', () => {
  let service: UnifiedAiService;

  beforeEach(() => {
    localStorage.clear();
    GeminiProvider.clearCache();
    service = new UnifiedAiService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    GeminiProvider.clearCache();
    localStorage.clear();
  });

  it('starts in mock mode when no Gemini key is configured', async () => {
    expect(await service.health()).toEqual({ status: 'ok', mode: 'mock' });
    const res = await service.chat('Fix this Python: for i in range(10) print(i)', []);
    expect(res.mode).toBe('mock');
    expect(res.routing.selectedModel).toBe('claude');
    expect(res.answer).toContain('range(10):');
  });

  it('persists feedback adjustments and resets them cleanly', async () => {
    const res = await service.chat('Fix this Python: for i in range(10) print(i)', []);
    const fb = await service.feedback({
      messageId: res.id,
      category: res.routing.category,
      model: res.routing.selectedModel,
      vote: 1,
    });
    expect(fb).toEqual({
      category: 'coding',
      model: 'claude',
      before: 95,
      after: 96,
      learnedAdjustment: 1,
    });

    const stats = await service.getStats();
    expect(stats.totalRouted).toBe(1);
    expect(stats.feedbackCount).toBe(1);

    await service.reset();
    expect((await service.getStats()).totalRouted).toBe(0);
    expect((await service.getBenchmarks()).categories['coding'].effective['claude']).toBe(95);
  });

  it('auto-discovers an available Gemini model and routes via Gemini API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('pageSize=100')) {
        return new Response(
          JSON.stringify({
            models: [
              { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      expect(urlStr).toContain('gemini-3.8-flash:generateContent');
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        contents?: { parts?: { text?: string }[] }[];
      };
      const prompt = body.contents?.at(-1)?.parts?.[0]?.text ?? '';
      let reply = 'Use `for i in range(10):` in Python.';
      if (prompt.includes('Classify the user')) {
        reply = '{"category":"coding","confidence":97,"language":"English","reason":"Python fix."}';
      } else if (prompt.includes('quality judge')) {
        reply = '{"score":94,"verdict":"Clear and concise"}';
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    expect(service.setApiKey('AIza-test-key')).toBe('gemini');
    expect(await service.health()).toEqual({ status: 'ok', mode: 'gemini' });

    const res = await service.chat('Fix my python loop', []);
    expect(res.mode).toBe('gemini');
    expect(res.routing.classifiedBy).toBe('ai');
    expect(res.routing.selectedModel).toBe('claude');
    expect(res.answer).toContain('range(10):');
    expect(res.quality).toEqual({ score: 94, verdict: 'Clear and concise' });
    // 1 ListModels discovery + 3 generateContent calls (classify, answer, judge)
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const firstCallHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(firstCallHeaders['x-goog-api-key']).toBe('AIza-test-key');

    expect(service.clearApiKey()).toBe('mock');
  });

  it('picks the newest non-specialized Flash model from candidates', () => {
    expect(
      pickBestGeminiModel([
        'gemini-2.5-pro',
        'gemini-2.5-flash-lite',
        'gemini-3.8-flash',
        'gemini-3.8-pro-preview',
      ]),
    ).toBe('gemini-3.8-flash');
  });

  it('maps Gemini invalid-key errors to a friendly ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid.' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    service.setApiKey('bad-key');
    await expect(service.chat('Hello', [])).rejects.toMatchObject({
      code: 'not_configured',
    });
  });
});
