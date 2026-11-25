import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadBenchmarks } from './catalog.ts';
import { resolveConfig } from './config.ts';
import { IMAGE_NOTE, runChat, type PipelineDeps } from './pipeline/chat.ts';
import { LearnedStore } from './pipeline/learning.ts';
import { MockProvider } from './providers/mock.provider.ts';
import type { AiProvider, ChatMessage } from './providers/provider.ts';

const benchmarks = loadBenchmarks();
const noDelay = { classify: [0, 0], judge: [0, 0] } as const;

function mockDeps(): PipelineDeps {
  return {
    mode: 'mock',
    provider: new MockProvider({ delayMs: [0, 0] }),
    routerModel: 'unused',
    benchmarks,
    learned: new LearnedStore(null),
    mockDelays: noDelay,
  };
}

describe('demo script (mock mode)', () => {
  const script: [string, string, string][] = [
    ['Fix this Python: for i in range(10) print(i)', 'coding', 'claude'],
    ['Solve the integral of x·e^x dx step by step', 'math', 'chatgpt'],
    ['What are the biggest AI news this week?', 'research', 'perplexity'],
    ['Translate "Good morning, how are you?" into Uzbek', 'translation', 'gemini'],
    ['Draw a logo for a coffee shop in Tashkent', 'image', 'dalle'],
    ['Write a short wedding toast for my sister', 'writing', 'claude'],
    ["Menga sog'lom nonushta uchun 3 ta g'oya ber", 'general', 'chatgpt'],
  ];
  for (const [prompt, category, model] of script) {
    it(`${prompt} → ${model}`, async () => {
      const r = await runChat(mockDeps(), prompt, []);
      assert.equal(r.routing.category, category);
      assert.equal(r.routing.selectedModel, model);
      assert.equal(r.mode, 'mock');
      assert.equal(r.answeredBy, undefined);
      assert.ok(r.quality.score >= 82 && r.quality.score <= 96);
      assert.ok(
        !r.answer.includes('{prompt}') && !r.answer.includes('Demo mode: this is a canned answer'),
        'expected the hand-written answer',
      );
    });
  }

  it('gives the hand-written answers', async () => {
    const deps = mockDeps();
    assert.match(
      (await runChat(deps, 'Fix this Python: for i in range(10) print(i)', [])).answer,
      /for i in range\(10\):\n {4}print\(i\)/,
    );
    assert.match(
      (await runChat(deps, 'Solve the integral of x·e^x dx step by step', [])).answer,
      /x·eˣ − eˣ \+ C/,
    );
    assert.match(
      (await runChat(deps, 'Translate "Good morning, how are you?" into Uzbek', [])).answer,
      /Xayrli tong, qalaysiz\?/,
    );
    const uzbek = await runChat(deps, "Menga sog'lom nonushta uchun 3 ta g'oya ber", []);
    assert.equal(uzbek.routing.language, 'Uzbek');
    assert.match(uzbek.answer, /^Mana sog'lom nonushta uchun 3 ta g'oya/);
    assert.ok(
      (await runChat(deps, 'Draw a logo for a coffee shop in Tashkent', [])).answer.endsWith(
        IMAGE_NOTE,
      ),
    );
  });

  it('matches demo prompts despite case, curly quotes and a missing question mark', async () => {
    const r = await runChat(mockDeps(), '  what are the biggest AI news this week ', []);
    assert.match(r.answer, /Demo mode has no live web access/);
    const quotes = await runChat(
      mockDeps(),
      'Translate “Good morning, how are you?” into Uzbek',
      [],
    );
    assert.match(quotes.answer, /Xayrli tong/);
  });

  it('answers other prompts from the category template, in the user’s language', async () => {
    const ru = await runChat(mockDeps(), 'Напиши письмо начальнику об отпуске', []);
    assert.equal(ru.routing.category, 'writing');
    assert.match(ru.answer, /> Напиши письмо начальнику об отпуске/);
    assert.match(ru.answer, /Демо-режим/);
    const uz = await runChat(mockDeps(), 'Menga Toshkentda qayerda ovqatlansam bo‘ladi?', []);
    assert.equal(uz.routing.language, 'Uzbek');
    assert.match(uz.answer, /Demo rejimi/);
  });

  it('routes differently once learned adjustments change the scores', async () => {
    const deps = mockDeps();
    deps.learned.apply('coding', 'claude', -2, 95);
    deps.learned.apply('coding', 'claude', -2, 95); // 95 − 4 = 91 < ChatGPT 92
    const r = await runChat(deps, 'Fix this Python: for i in range(10) print(i)', []);
    assert.equal(r.routing.selectedModel, 'chatgpt');
    assert.deepEqual(r.routing.ranking[1], {
      model: 'claude',
      score: 91,
      baseScore: 95,
      learnedAdjustment: -4,
    });
  });
});

describe('openrouter mode', () => {
  /** Records each call; the router and judge get JSON, answer calls get "answer from <model>". */
  function recordingProvider(category: string) {
    const calls: { modelId: string; messages: ChatMessage[] }[] = [];
    const provider: AiProvider = {
      async complete(modelId, messages) {
        calls.push({ modelId, messages });
        if (modelId === 'router') {
          return messages[0].content.includes('quality judge')
            ? '{"score":90,"verdict":"Solid"}'
            : `{"category":"${category}","confidence":93,"language":"English","reason":"Test."}`;
        }
        return `answer from ${modelId}`;
      },
    };
    return { calls, provider };
  }

  it('sends the prompt to the chosen model with the system prompt and history', async () => {
    const { calls, provider } = recordingProvider('coding');
    const history: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const r = await runChat(
      { ...mockDeps(), mode: 'openrouter', provider, routerModel: 'router' },
      'fix my code',
      history,
    );
    assert.equal(r.routing.classifiedBy, 'ai');
    assert.equal(r.answer, 'answer from anthropic/claude-sonnet-4.5');
    assert.deepEqual(r.quality, { score: 90, verdict: 'Solid' });
    const answerCall = calls[1];
    assert.equal(answerCall.messages[0].role, 'system');
    assert.match(answerCall.messages[0].content, /You are answering inside Unified AI/);
    assert.deepEqual(answerCall.messages.slice(1), [
      ...history,
      { role: 'user', content: 'fix my code' },
    ]);
  });

  it('lets the best text model write an image prompt in place of DALL·E', async () => {
    const { calls, provider } = recordingProvider('image');
    const r = await runChat(
      { ...mockDeps(), mode: 'openrouter', provider, routerModel: 'router' },
      'a cat',
      [],
    );
    assert.equal(r.routing.selectedModel, 'dalle');
    assert.equal(r.answeredBy, 'gemini');
    assert.equal(calls[1].modelId, 'google/gemini-2.5-pro');
    assert.ok(
      calls[1].messages.some((m) => m.role === 'system' && m.content.includes('image prompt')),
    );
    assert.ok(r.answer.endsWith(IMAGE_NOTE));
  });
});

describe('resolveConfig', () => {
  it('defaults to mock and falls back to it without a key', () => {
    assert.equal(resolveConfig({}).config.mode, 'mock');
    const noKey = resolveConfig({ UNIFIED_AI_MODE: 'openrouter' });
    assert.equal(noKey.config.mode, 'mock');
    assert.match(noKey.warnings[0], /OPENROUTER_API_KEY is empty/);
    const live = resolveConfig({ UNIFIED_AI_MODE: 'OpenRouter', OPENROUTER_API_KEY: 'sk-or-test' });
    assert.equal(live.config.mode, 'openrouter');
    assert.equal(live.config.openrouterBaseUrl, 'https://openrouter.ai/api/v1');
  });
});
