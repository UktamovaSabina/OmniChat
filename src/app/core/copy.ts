/** Example prompts for the empty state: the demo script, one per model. */
export const EXAMPLES: readonly string[] = [
  'Fix this Python: for i in range(10) print(i)',
  'Solve the integral of x·e^x dx step by step',
  'What are the biggest AI news this week?',
  'Translate "Good morning, how are you?" into Uzbek',
  'Draw a logo for a coffee shop in Tashkent',
  'Write a short wedding toast for my sister',
  "Menga sog'lom nonushta uchun 3 ta g'oya ber",
];

/** The flow strip on the empty state. */
export const FLOW: readonly string[] = [
  'Understand',
  'Compare benchmarks',
  'Pick best AI',
  'Answer',
  'Quality check',
];

/** The five pills on each answer card, in order. */
export const PIPELINE_STEPS: readonly string[] = [
  'Understanding prompt',
  'Comparing benchmarks',
  'Selecting AI',
  'Answering',
  'Quality check',
];

/** Index of the "Answering" step, "Quality check" step, and the value meaning "all done". */
export const STEP = { answering: 3, quality: 4, done: 5 } as const;

/** What the card says while each of the first steps is active. */
export const WAITING_TEXT: readonly string[] = [
  'Reading your prompt…',
  'Comparing benchmark scores…',
  'Selecting the best AI…',
  'Waiting for the answer…',
];

export const HOW_IT_WORKS: readonly { title: string; text: string }[] = [
  {
    title: 'Understand',
    text: 'an AI router reads the prompt and detects the task type, language and confidence.',
  },
  { title: 'Compare', text: "it looks up every model's benchmark score for that task." },
  { title: 'Pick', text: 'the highest score wins; if scores tie, the cheaper model wins.' },
  { title: 'Answer', text: 'the prompt goes to that model through one API (OpenRouter).' },
  {
    title: 'Check & learn',
    text: 'an AI judge rates the answer, and 👍/👎 adjust the scores over time.',
  },
];
