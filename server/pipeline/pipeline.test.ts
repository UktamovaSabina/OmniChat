import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadBenchmarks, type Benchmarks } from '../catalog.ts';
import type { AiProvider } from '../providers/provider.ts';
import { classifyByRules, classifyWithAi, detectLanguage } from './classifier.ts';
import { judgeByRules, judgeWithAi } from './judge.ts';
import { LearnedStore } from './learning.ts';
import { rankModels } from './router.ts';

const benchmarks = loadBenchmarks();
const noLearning = { get: () => 0 };

/** A provider that always replies with `reply` (or throws it, if it's an Error). */
const fakeProvider = (reply: string | Error): AiProvider => ({
  async complete() {
    if (reply instanceof Error) throw reply;
    return reply;
  },
});

describe('classifyByRules', () => {
  const cases: [string, string, string][] = [
    ['Fix this Python: for i in range(10) print(i)', 'coding', 'English'],
    ['Solve the integral of x·e^x dx step by step', 'math', 'English'],
    ['What are the biggest AI news this week?', 'research', 'English'],
    ['Translate "Good morning, how are you?" into Uzbek', 'translation', 'English'],
    ['Draw a logo for a coffee shop in Tashkent', 'image', 'English'],
    ['Write a short wedding toast for my sister', 'writing', 'English'],
    ["Menga sog'lom nonushta uchun 3 ta g'oya ber", 'general', 'Uzbek'],
    ['What is 12 * 7?', 'math', 'English'],
    ['Write a Python function that reverses a list', 'coding', 'English'],
    ['Нарисуй кота в космосе', 'image', 'Russian'],
    ['Переведи это на английский', 'translation', 'Russian'],
    ['Напиши стих про осень', 'writing', 'Russian'],
    ['Python kodimda xato bor, tuzatib bering', 'coding', 'Uzbek'],
    ['Bu tenglamani yeching: 2x + 3 = 7', 'math', 'Uzbek'],
    ['Why is the sky blue?', 'general', 'English'],
  ];
  for (const [prompt, category, language] of cases) {
    it(`${prompt} → ${category}, ${language}`, () => {
      const c = classifyByRules(prompt);
      assert.equal(c.category, category);
      assert.equal(c.language, language);
      assert.equal(c.by, 'rules');
      assert.ok(c.reason.split(' ').length <= 12, `reason too long: ${c.reason}`);
    });
  }

  it('is confident about keyword matches and less so about general questions', () => {
    const coding = classifyByRules('Fix this Python: for i in range(10) print(i)');
    assert.ok(coding.confidence >= 85 && coding.confidence <= 98, `coding: ${coding.confidence}`);
    const general = classifyByRules('Why is the sky blue?');
    assert.ok(
      general.confidence >= 60 && general.confidence <= 75,
      `general: ${general.confidence}`,
    );
  });

  it('gives specific reasons for the demo prompts', () => {
    assert.equal(
      classifyByRules('Fix this Python: for i in range(10) print(i)').reason,
      'Contains Python code and asks for a fix.',
    );
    assert.equal(
      classifyByRules('Solve the integral of x·e^x dx step by step').reason,
      'Asks to solve an integral step by step.',
    );
    assert.equal(
      classifyByRules('Translate "Good morning, how are you?" into Uzbek').reason,
      'Asks to translate a phrase into Uzbek.',
    );
  });

  it('returns the same result for the same prompt', () => {
    assert.deepEqual(classifyByRules('Draw a cat'), classifyByRules('Draw a cat'));
  });
});

describe('detectLanguage', () => {
  it('tells English, Uzbek (Latin and Cyrillic) and Russian apart', () => {
    assert.equal(detectLanguage("What's the time? It's 5 o'clock"), 'English');
    assert.equal(detectLanguage('Qanday qilib ingliz tilini o‘rgansam bo‘ladi?'), 'Uzbek');
    assert.equal(detectLanguage('Хайрли тонг, қалайсиз?'), 'Uzbek');
    assert.equal(detectLanguage('Как дела?'), 'Russian');
  });
});

describe('classifyWithAi', () => {
  it('uses the AI answer when it is valid JSON', async () => {
    const provider = fakeProvider(
      '```json\n{"category":"Math","confidence":"91","language":"English","reason":"An equation."}\n```',
    );
    const c = await classifyWithAi(provider, 'router', 'what is x if 2x = 4');
    assert.deepEqual(c, {
      category: 'math',
      confidence: 91,
      language: 'English',
      reason: 'An equation.',
      by: 'ai',
    });
  });

  it('falls back to the keyword rules on a bad reply or an error', async () => {
    const bad = await classifyWithAi(fakeProvider('{"category":"poetry"}'), 'router', 'Draw a cat');
    assert.equal(bad.by, 'rules');
    assert.equal(bad.category, 'image');
    const failed = await classifyWithAi(fakeProvider(new Error('boom')), 'router', 'Draw a cat');
    assert.equal(failed.by, 'rules');
  });
});

describe('rankModels', () => {
  it('ranks by score, highest first', () => {
    const coding = rankModels(benchmarks, 'coding', noLearning);
    assert.deepEqual(coding[0], {
      model: 'claude',
      score: 95,
      baseScore: 95,
      learnedAdjustment: 0,
    });
    assert.equal(rankModels(benchmarks, 'research', noLearning)[0].model, 'perplexity');
    assert.equal(rankModels(benchmarks, 'image', noLearning)[0].model, 'dalle');
  });

  it('breaks a tie with the cheaper model, then with the order the category lists its scores', () => {
    const tied: Benchmarks = structuredClone(benchmarks);
    tied.categories.general.scores = { claude: 90, gemini: 90 };
    assert.equal(rankModels(tied, 'general', noLearning)[0].model, 'gemini'); // costTier 1 beats 2

    // ChatGPT and Claude both score 90 with costTier 2; ChatGPT is listed first.
    assert.deepEqual(
      rankModels(benchmarks, 'general', noLearning).map((r) => r.model),
      ['chatgpt', 'claude', 'gemini', 'perplexity'],
    );
  });

  it('adds learned adjustments and clamps to 0–100', () => {
    const learned = {
      get: (_c: string, m: string) => (m === 'chatgpt' ? 4 : m === 'claude' ? 9 : 0),
    };
    const ranked = rankModels(benchmarks, 'coding', learned);
    assert.deepEqual(ranked[0], {
      model: 'claude',
      score: 100,
      baseScore: 95,
      learnedAdjustment: 9,
    });
    assert.equal(ranked[1].score, 96);
  });
});

describe('LearnedStore', () => {
  it('applies 👍 +1 / 👎 −2, keeps scores within 0–100 and persists to disk', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'unified-ai-')), 'learned.json');
    const store = new LearnedStore(file);
    assert.deepEqual(store.apply('coding', 'claude', 1, 95), {
      before: 95,
      after: 96,
      adjustment: 1,
    });
    assert.deepEqual(store.apply('coding', 'claude', -2, 95), {
      before: 96,
      after: 94,
      adjustment: -1,
    });
    for (let i = 0; i < 10; i++) store.apply('coding', 'chatgpt', 1, 92);
    assert.equal(store.get('coding', 'chatgpt'), 8); // 92 + 8 = 100, the cap

    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
      coding: { claude: -1, chatgpt: 8 },
    });
    assert.equal(new LearnedStore(file).get('coding', 'claude'), -1);

    store.reset();
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {});
  });
});

describe('judge', () => {
  it('gives the same answer the same score, between 82 and 96', () => {
    const a = judgeByRules('Some answer');
    assert.deepEqual(a, judgeByRules('Some answer'));
    for (const text of ['a', 'b', 'c', 'longer answer', 'x·eˣ − eˣ + C']) {
      const { score } = judgeByRules(text);
      assert.ok(score >= 82 && score <= 96, `score ${score}`);
    }
  });

  it('uses the AI verdict when valid and falls back otherwise', async () => {
    assert.deepEqual(
      await judgeWithAi(fakeProvider('{"score":88,"verdict":"Good"}'), 'j', 'q', 'a'),
      {
        score: 88,
        verdict: 'Good',
      },
    );
    assert.deepEqual(await judgeWithAi(fakeProvider('not json'), 'j', 'q', 'a'), judgeByRules('a'));
  });
});
