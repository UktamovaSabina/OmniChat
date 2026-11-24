import { CATEGORIES, isCategory, keywordRoute, rankModels } from './routing';

describe('keywordRoute', () => {
  it.each([
    ['Fix this Python: for i in range(10) print(i)', 'coding'],
    ['Solve the integral of x·e^x dx step by step', 'math'],
    ['What is 12 * 7?', 'math'],
    ['Write a short wedding toast for my sister', 'writing'],
    ['What are the latest AI news this week?', 'research'],
    ['Draw a logo for a coffee shop in Tashkent', 'image'],
    ['Translate "Good morning, how are you?" into Uzbek', 'translation'],
    ['Нарисуй кота', 'image'],
    ['Переведи это на английский', 'translation'],
    ['Why is the sky blue?', 'general'],
  ] as const)('routes %j to %s', (question, expected) => {
    expect(keywordRoute(question)).toBe(expected);
  });
});

describe('rankModels', () => {
  it('puts the highest score first', () => {
    expect(rankModels('coding')[0]).toEqual({ model: 'claude', score: 95 });
    expect(rankModels('research')[0].model).toBe('perplexity');
  });

  it('breaks a tie in favour of the cheaper model', () => {
    // General: ChatGPT and Claude both score 90 at the same cost, so table order holds;
    // force a tie against a cheaper model to check the cost rule.
    const general = rankModels('general');
    expect(general.map((r) => r.score)).toEqual([90, 90, 89]);

    const original = CATEGORIES.general.scores;
    CATEGORIES.general.scores = { claude: 90, gemini: 90 };
    try {
      expect(rankModels('general')[0].model).toBe('gemini'); // cost 1 beats cost 2
    } finally {
      CATEGORIES.general.scores = original;
    }
  });
});

describe('isCategory', () => {
  it('accepts known categories only', () => {
    expect(isCategory('coding')).toBe(true);
    expect(isCategory('toString')).toBe(false);
    expect(isCategory(42)).toBe(false);
  });
});
