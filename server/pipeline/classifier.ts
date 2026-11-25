import * as z from 'zod';
import { isCategory, type Category } from '../catalog.ts';
import type { AiProvider } from '../providers/provider.ts';
import { clamp, describeError, extractJson, hash } from '../util.ts';

export interface Classification {
  category: Category;
  /** 0–100 */
  confidence: number;
  /** Language name in English, e.g. "Uzbek". */
  language: string;
  /** Why this category, in a few words. */
  reason: string;
  /** "rules" = keyword rules (mock mode, or the fallback); "ai" = the AI router. */
  by: 'rules' | 'ai';
}

// ------------------------------------------------------------------ keyword rules

type RuleCategory = Exclude<Category, 'general'>;

interface Rule {
  re: RegExp;
  /** What the match is about, for the reason text ("a logo", "Python"). */
  topic?: string | ((m: RegExpExecArray) => string | undefined);
  flag?: string;
}

interface Hit {
  count: number;
  topics: string[];
  flags: Set<string>;
}

/** Picks the topic whose key the matched text starts with. */
const lookup =
  (table: Record<string, string>) =>
  (m: RegExpExecArray): string | undefined =>
    Object.entries(table).find(([key]) => m[0].trim().startsWith(key))?.[1];

const LANGUAGE_NAMES: Record<string, string> = {
  english: 'English',
  uzbek: 'Uzbek',
  russian: 'Russian',
  french: 'French',
  german: 'German',
  spanish: 'Spanish',
  italian: 'Italian',
  turkish: 'Turkish',
  arabic: 'Arabic',
  chinese: 'Chinese',
  korean: 'Korean',
  japanese: 'Japanese',
  kazakh: 'Kazakh',
  tajik: 'Tajik',
  kyrgyz: 'Kyrgyz',
  // Uzbek "... tiliga" and Russian "на ..." forms
  ingliz: 'English',
  rus: 'Russian',
  "o'zbek": 'Uzbek',
  nemis: 'German',
  fransuz: 'French',
  turk: 'Turkish',
  koreys: 'Korean',
  xitoy: 'Chinese',
  arab: 'Arabic',
  английск: 'English',
  русск: 'Russian',
  узбекск: 'Uzbek',
  немецк: 'German',
  французск: 'French',
  испанск: 'Spanish',
  турецк: 'Turkish',
  китайск: 'Chinese',
  корейск: 'Korean',
};

const PROGRAMMING: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  php: 'PHP',
  ruby: 'Ruby',
  rust: 'Rust',
  golang: 'Go',
  kotlin: 'Kotlin',
  swift: 'Swift',
  react: 'React',
  angular: 'Angular',
  bash: 'Bash',
  node: 'Node.js',
  'c++': 'C++',
  'c#': 'C#',
};

const WRITING_FORMS: Record<string, string> = {
  essay: 'an essay',
  story: 'a story',
  poem: 'a poem',
  toast: 'a toast',
  speech: 'a speech',
  email: 'an email',
  'e-mail': 'an email',
  'cover letter': 'a cover letter',
  letter: 'a letter',
  article: 'an article',
  caption: 'a caption',
  slogan: 'a slogan',
  bio: 'a bio',
  tweet: 'a tweet',
  song: 'a song',
  lyrics: 'lyrics',
  blog: 'a blog post',
  resume: 'a CV',
  cv: 'a CV',
  "she'r": 'a poem',
  hikoya: 'a story',
  xat: 'a letter',
  insho: 'an essay',
  tabrik: 'a greeting',
  maqola: 'an article',
  стих: 'a poem',
  рассказ: 'a story',
  письм: 'a letter',
  эссе: 'an essay',
  тост: 'a toast',
  поздравлен: 'a greeting',
  стать: 'an article',
};

/** Order matters only for ties: the category listed first wins. */
const RULES: Record<RuleCategory, { rules: Rule[]; reason: (hit: Hit, text: string) => string }> = {
  image: {
    rules: [
      { re: /\b(draw|sketch|paint|illustrate)\b|chiz|нарису|рисун/, flag: 'draw' },
      { re: /\blogo(type)?s?\b|logotip|логотип/, topic: 'a logo' },
      { re: /\b(poster|banner|flyer)s?\b|afisha|плакат|постер/, topic: 'a poster' },
      {
        re: /\b(image|picture|photo|illustration|drawing|wallpaper|avatar)s?\b|rasm|surat|картин|изображен|иллюстрац/,
        topic: 'an image',
      },
    ],
    reason: (h) =>
      `Asks to create ${h.topics[0] ?? 'a picture'}, which is an image-generation task.`,
  },
  translation: {
    rules: [
      { re: /\btranslat(e|es|ed|ing|ion)\b|tarjima|перев[оеё]д/, flag: 'translate' },
      {
        re: /\b(?:into|to) (english|uzbek|russian|french|german|spanish|italian|turkish|arabic|chinese|korean|japanese|kazakh|tajik|kyrgyz)\b/,
        topic: (m) => LANGUAGE_NAMES[m[1]],
      },
      {
        re: /(ingliz|rus|o'zbek|nemis|fransuz|turk|koreys|xitoy|arab) tiliga/,
        topic: (m) => LANGUAGE_NAMES[m[1]],
      },
      {
        re: /на (английск|русск|узбекск|немецк|французск|испанск|турецк|китайск|корейск)/,
        topic: (m) => LANGUAGE_NAMES[m[1]],
      },
      { re: /\bhow (do|would|can) (you|i) say\b/, flag: 'say' },
    ],
    reason: (h) =>
      h.topics[0]
        ? `Asks to translate a phrase into ${h.topics[0]}.`
        : 'Asks for a translation between languages.',
  },
  coding: {
    rules: [
      {
        re: /\b(python|javascript|typescript|java|sql|html|css|php|ruby|rust|golang|kotlin|swift|react|angular|bash|node)\b|(?:^|\s)(c\+\+|c#)(?=[\s.,?!:]|$)/,
        topic: (m) => PROGRAMMING[m[1] ?? m[2]],
      },
      {
        re: /\b(fix|bugs?|debug|errors?|exception|traceback|crash(es|ing)?)\b|doesn't work|not working|xato|ошибк|баг/,
        flag: 'fix',
      },
      {
        re: /\b(code|coding|function|script|regex|api|algorithm|compiler?|programming)\b|\bkod|код|функци|скрипт/,
        flag: 'code',
      },
      {
        // Code itself: a call such as print(i) or range(10), an arrow function, a statement end, a tag.
        re: /\b(print|range|len|console\.log|printf|input)\s*\(|\bdef \w+\s*\(|=>|[{};]\s*$|<\/?[a-z][a-z0-9]*[\s>]/m,
        flag: 'syntax',
      },
    ],
    reason: (h) => {
      const what = h.topics[0] ? `${h.topics[0]} code` : 'code';
      if (h.flags.has('fix') && h.flags.has('syntax'))
        return `Contains ${what} and asks for a fix.`;
      if (h.flags.has('fix')) return `Asks to fix ${what}.`;
      if (h.flags.has('syntax')) return `Contains ${what} to work on.`;
      return `A programming question about ${h.topics[0] ?? 'code'}.`;
    },
  },
  math: {
    rules: [
      {
        re: /\b(solve|calculate|compute|evaluate|simplify|prove|factori[sz]e)\b|yech|hisobla|реши|вычисл|посчитай/,
        flag: 'solve',
      },
      { re: /\bintegra(l|ls|te)\b|интеграл/, topic: 'an integral' },
      { re: /\b(derivative|differentiate)s?\b|hosila|производн/, topic: 'a derivative' },
      { re: /\b(equation|inequality)s?\b|tenglama|уравнени/, topic: 'an equation' },
      {
        re: /\b(math|maths|algebra|geometry|calculus|probability|percentage|fraction|logarithm|matrix)\b|matematika|ehtimol|математик|вероятност/,
        topic: 'a math problem',
      },
      // An expression: 12 * 7, 3 - 1, x^2, e^x, 15%
      {
        re: /\d\s*[+*/×÷=^]\s*\d|\d\s+-\s+\d|[a-z0-9)]\s*\^\s*[a-z0-9(]|\d\s*%/,
        flag: 'expression',
      },
    ],
    reason: (h, text) => {
      const steps = /step[ -]by[ -]step|bosqichma|пошагов|по шагам/.test(text)
        ? ' step by step'
        : '';
      const topic = h.topics[0];
      if (h.flags.has('solve') && topic) return `Asks to solve ${topic}${steps}.`;
      if (topic) return `A math question involving ${topic}.`;
      if (h.flags.has('expression') && !h.flags.has('solve'))
        return 'Contains a math expression to work out.';
      return `Asks for a calculation${steps}.`;
    },
  },
  research: {
    rules: [
      { re: /\b(news|headlines?)\b|yangilik|новост/, topic: 'news' },
      {
        re: /\b(latest|today|tonight|yesterday|this (week|month|year)|right now|currently|recent(ly)?|breaking)\b|bugun|hozir|shu hafta|сегодня|сейчас|вчера|на этой неделе|последн/,
        flag: 'recent',
      },
      {
        re: /\b(prices?|stocks?|exchange rate|weather|forecast)\b|narx|ob-havo|цена|цены|курс валют|погод/,
        topic: 'live data',
      },
      { re: /\b(who won|what happened|look up|search the web)\b/, flag: 'lookup' },
    ],
    reason: (h) => {
      if (h.topics.includes('news')) {
        return h.flags.has('recent')
          ? 'Asks for recent news, which needs up-to-date sources.'
          : 'Asks about the news, which needs up-to-date sources.';
      }
      if (h.topics.includes('live data'))
        return 'Needs live data such as prices, which change daily.';
      return 'Asks about recent events, so it needs current sources.';
    },
  },
  writing: {
    rules: [
      {
        re: /\b(write|draft|compose|rewrite|proofread|paraphrase)\b|\byoz|напиши|написать|сочини|составь/,
        flag: 'write',
      },
      {
        re: /\b(essay|story|poem|toast|speech|e-?mail|cover letter|letter|article|caption|slogan|bio|tweet|song|lyrics|blog|resume|cv)\b/,
        topic: lookup(WRITING_FORMS),
      },
      { re: /she'r|hikoya|\bxat(ni|ga|lar)?\b|insho|tabrik|maqola/, topic: lookup(WRITING_FORMS) },
      { re: /стих|рассказ|письм|эссе|тост|поздравлен|стать[яюи]/, topic: lookup(WRITING_FORMS) },
    ],
    reason: (h) =>
      h.topics[0]
        ? `Asks to write ${h.topics[0]}: a creative writing task.`
        : 'Asks for written text: a writing task.',
  },
};

const PRIORITY = Object.keys(RULES) as RuleCategory[];

/** Lowercase, with curly quotes and Uzbek apostrophes (ʻ ’) turned into plain ones. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʻʼ`]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, ' ');
}

function scan(text: string, rules: Rule[]): Hit {
  const hit: Hit = { count: 0, topics: [], flags: new Set() };
  for (const rule of rules) {
    const m = rule.re.exec(text);
    if (!m) continue;
    hit.count++;
    if (rule.flag) hit.flags.add(rule.flag);
    const topic = typeof rule.topic === 'function' ? rule.topic(m) : rule.topic;
    if (topic) hit.topics.push(topic);
  }
  return hit;
}

/** Words that are clearly Uzbek count 2; short or ambiguous ones count 1. */
const UZBEK_STRONG =
  /\b(menga|menda|sizga|uchun|qanday|qanaqa|nimaga|nega|qayerda|qachon|qaysi|nechta|qancha|iltimos|assalomu|rahmat|haqida|mumkinmi|kerakmi|ayting|yozing|bering|qiling|yeching|toping|hisoblang|tuzating|tushuntir\w*)\b/g;
const UZBEK_WEAK = /\b(bu|va|ham|yoki|emas|ber|nima|salom|kerak|yordam|bilan)\b/g;

/** English, Uzbek or Russian, from the script and some common Uzbek words and letters (o', g'). */
export function detectLanguage(message: string): string {
  const cyrillic = message.match(/[а-яёқғўҳ]/gi)?.length ?? 0;
  const latin = message.match(/[a-z]/gi)?.length ?? 0;
  if (cyrillic > latin) return /[қғўҳ]/i.test(message) ? 'Uzbek' : 'Russian';

  const s = normalize(message);
  const apostropheLetters = s.match(/[og]'[a-z]/g)?.length ?? 0; // sog'lom, g'oya, o'zbek
  const strong = s.match(UZBEK_STRONG)?.length ?? 0;
  const weak = s.match(UZBEK_WEAK)?.length ?? 0;
  return apostropheLetters + 2 * strong + weak >= 2 ? 'Uzbek' : 'English';
}

/** Mock-mode classifier: keyword rules in English, Uzbek and Russian. The category with the most matches wins. */
export function classifyByRules(message: string): Classification {
  const text = normalize(message);
  const language = detectLanguage(message);
  const jitter = hash(text);

  let best: { category: RuleCategory; hit: Hit } | undefined;
  let runnerUp = 0;
  for (const category of PRIORITY) {
    const hit = scan(text, RULES[category].rules);
    if (!hit.count) continue;
    if (!best || hit.count > best.hit.count) {
      if (best) runnerUp = Math.max(runnerUp, best.hit.count);
      best = { category, hit };
    } else {
      runnerUp = Math.max(runnerUp, hit.count);
    }
  }

  if (!best) {
    return {
      category: 'general',
      confidence: 60 + (jitter % 16), // 60–75
      language,
      reason:
        language === 'English'
          ? "No specialist keywords, so it's treated as a general question."
          : `No specialist task detected; a general question in ${language}.`,
      by: 'rules',
    };
  }

  // More matching keywords → more confident; a close second category → less confident.
  const confidence = clamp(85 + (best.hit.count - 1) * 4 + (jitter % 3) - runnerUp * 4, 70, 98);
  return {
    category: best.category,
    confidence,
    language,
    reason: RULES[best.category].reason(best.hit, text),
    by: 'rules',
  };
}

// ------------------------------------------------------------------ AI router (openrouter mode)

export function classifierPrompt(message: string): string {
  return `You are the routing brain of "Unified AI". Classify the user's request into exactly ONE category:
coding, math, writing, research (needs current facts/news), image (wants a picture created),
translation, general. The request may be in English, Uzbek or Russian.
Return ONLY JSON: {"category":"...","confidence":0-100,"language":"...","reason":"max 12 words"}
User request: """${message}"""`;
}

const AiReply = z.object({
  category: z.string(),
  confidence: z.coerce.number(),
  language: z.string().default(''),
  reason: z.string().default(''),
});

/** Asks a small, fast model to classify; falls back to the keyword rules on any error. */
export async function classifyWithAi(
  provider: AiProvider,
  model: string,
  message: string,
  signal?: AbortSignal,
): Promise<Classification> {
  try {
    const reply = await provider.complete(
      model,
      [{ role: 'user', content: classifierPrompt(message) }],
      {
        maxTokens: 200,
        temperature: 0,
        signal,
      },
    );
    const parsed = AiReply.parse(extractJson(reply));
    const category = parsed.category.trim().toLowerCase();
    if (!isCategory(category)) throw new Error(`unknown category "${parsed.category}"`);
    return {
      category,
      confidence: clamp(Math.round(parsed.confidence), 0, 100),
      language: parsed.language.trim() || detectLanguage(message),
      reason: parsed.reason.trim() || 'Classified by the AI router.',
      by: 'ai',
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn(
      `[classifier] AI router failed, using keyword rules instead. ${describeError(err)}`,
    );
    return classifyByRules(message);
  }
}
