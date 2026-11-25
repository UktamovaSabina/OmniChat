import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { CATEGORY_IDS, DATA_DIR, isCategory, loadBenchmarks, type Category } from './catalog.ts';
import { resolveConfig } from './config.ts';
import { runChat } from './pipeline/chat.ts';
import { LearnedStore, VOTE_DELTA } from './pipeline/learning.ts';
import { rankModels } from './pipeline/router.ts';
import { MockProvider } from './providers/mock.provider.ts';
import { OpenRouterProvider } from './providers/openrouter.provider.ts';
import { ProviderError, type AiProvider, type ChatMessage } from './providers/provider.ts';
import { Stats } from './stats.ts';
import { describeError } from './util.ts';

const MAX_MESSAGE_CHARS = 20_000;
const MAX_HISTORY_TURNS = 20;
const MAX_REMEMBERED_MESSAGES = 2_000;

const { config, warnings } = resolveConfig();
for (const warning of warnings) console.warn(`[config] ${warning}`);

const benchmarks = loadBenchmarks();
const learned = new LearnedStore(path.join(DATA_DIR, 'learned.json'));
const stats = new Stats();
const provider: AiProvider =
  config.mode === 'openrouter'
    ? new OpenRouterProvider({ apiKey: config.openrouterKey, baseUrl: config.openrouterBaseUrl })
    : new MockProvider();

/** Routed answers by id, so each one gets at most one vote, applied to the model the router picked. */
const routed = new Map<string, { category: Category; model: string; voted: boolean }>();

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', mode: config.mode });
});

app.post('/api/chat', async (req: Request, res: Response) => {
  const parsed = parseChatBody(req.body);
  if (typeof parsed === 'string') {
    res.status(400).json({ code: 'bad_request', message: parsed });
    return;
  }

  // Stop paying for tokens if the browser goes away before the answer is ready.
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const result = await runChat(
      { mode: config.mode, provider, routerModel: config.routerModel, benchmarks, learned },
      parsed.message,
      parsed.history,
      abort.signal,
    );
    stats.recordChat(result.routing.selectedModel, result.quality.score);
    remember(result.id, result.routing.category, result.routing.selectedModel);
    res.json(result);
  } catch (err) {
    if (abort.signal.aborted) return;
    if (err instanceof ProviderError) {
      console.error(`[chat] ${err.code}: ${err.message}`);
      res.status(err.status).json({ code: err.code, message: err.message });
      return;
    }
    console.error(`[chat] ${describeError(err)}`);
    res.status(500).json({ code: 'internal', message: 'Unexpected server error.' });
  }
});

app.post('/api/feedback', (req: Request, res: Response) => {
  const { messageId, category, model, vote } = (req.body ?? {}) as Record<string, unknown>;
  if (vote !== 1 && vote !== -1) {
    res.status(400).json({ code: 'bad_request', message: '"vote" must be 1 (👍) or -1 (👎).' });
    return;
  }

  // Trust what the server routed over what the client says, when the server still remembers the message.
  const known = typeof messageId === 'string' ? routed.get(messageId) : undefined;
  if (known?.voted) {
    res.status(409).json({ code: 'already_voted', message: 'This answer already has a vote.' });
    return;
  }
  const cat = known?.category ?? category;
  const mdl = known?.model ?? model;
  if (
    !isCategory(cat) ||
    typeof mdl !== 'string' ||
    benchmarks.categories[cat].scores[mdl] === undefined
  ) {
    res
      .status(400)
      .json({
        code: 'bad_request',
        message: 'Unknown category, or that model has no score for it.',
      });
    return;
  }

  const base = benchmarks.categories[cat].scores[mdl];
  const { before, after, adjustment } = learned.apply(
    cat,
    mdl,
    vote > 0 ? VOTE_DELTA.up : VOTE_DELTA.down,
    base,
  );
  if (known) known.voted = true;
  stats.recordFeedback();
  res.json({ category: cat, model: mdl, before, after, learnedAdjustment: adjustment });
});

app.get('/api/benchmarks', (_req, res) => {
  const categories = Object.fromEntries(
    CATEGORY_IDS.map((id) => {
      const { label, short, scores } = benchmarks.categories[id];
      const ranking = rankModels(benchmarks, id, learned);
      return [
        id,
        {
          label,
          short,
          scores,
          effective: Object.fromEntries(ranking.map((r) => [r.model, r.score])),
          adjustments: Object.fromEntries(
            ranking.filter((r) => r.learnedAdjustment).map((r) => [r.model, r.learnedAdjustment]),
          ),
          best: ranking[0].model,
          ranking,
        },
      ];
    }),
  );
  res.json({ models: benchmarks.models, categories, source: benchmarks.source });
});

app.get('/api/stats', (_req, res) => {
  res.json(stats.snapshot());
});

/** Clears stats and learned adjustments, e.g. right before a live demo. */
app.post('/api/reset', (_req, res) => {
  stats.reset();
  learned.reset();
  routed.clear();
  res.json({ status: 'ok' });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ code: 'not_found', message: 'No such API endpoint.' });
});

// Serve the production build of the Angular app when it exists (npm run build).
const browserDir = path.resolve(import.meta.dirname, '../dist/unified-ai/browser');
if (existsSync(browserDir)) {
  app.use(express.static(browserDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(browserDir, 'index.html')));
}

// Malformed or oversized JSON bodies get a JSON error instead of Express's HTML page.
app.use(
  (err: { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ code: 'bad_request', message: 'The request body is not valid JSON.' });
    } else if (err.type === 'entity.too.large') {
      res.status(413).json({ code: 'bad_request', message: 'The request is too large.' });
    } else {
      console.error(`[server] ${describeError(err)}`);
      res.status(err.status ?? 500).json({ code: 'internal', message: 'Unexpected server error.' });
    }
  },
);

function parseChatBody(body: unknown): { message: string; history: ChatMessage[] } | string {
  if (!body || typeof body !== 'object') return 'Expected a JSON body.';
  const { message, history } = body as { message?: unknown; history?: unknown };
  if (typeof message !== 'string' || !message.trim()) return 'Send a non-empty "message" string.';
  if (message.length > MAX_MESSAGE_CHARS)
    return `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`;

  const turns: ChatMessage[] = [];
  if (history !== undefined) {
    if (!Array.isArray(history)) return '"history" must be an array of { role, content }.';
    for (const turn of history) {
      const { role, content } = (turn ?? {}) as { role?: unknown; content?: unknown };
      if (
        (role !== 'user' && role !== 'assistant') ||
        typeof content !== 'string' ||
        !content.trim()
      ) {
        return 'Each history item needs role "user" or "assistant" and non-empty string content.';
      }
      if (content.length > MAX_MESSAGE_CHARS)
        return `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`;
      turns.push({ role, content });
    }
  }
  // Keep the most recent turns, starting on a user message.
  const recent = turns.slice(-MAX_HISTORY_TURNS);
  const firstUser = recent.findIndex((t) => t.role === 'user');
  return { message: message.trim(), history: firstUser < 0 ? [] : recent.slice(firstUser) };
}

function remember(id: string, category: Category, model: string) {
  routed.set(id, { category, model, voted: false });
  if (routed.size > MAX_REMEMBERED_MESSAGES) routed.delete(routed.keys().next().value!);
}

app.listen(config.port, () => {
  console.log(`Unified AI API listening on http://localhost:${config.port}`);
  console.log(
    config.mode === 'mock'
      ? '  Mode: mock (simulated answers, no API calls). Set UNIFIED_AI_MODE=openrouter in .env for real models.'
      : `  Mode: openrouter (${config.openrouterBaseUrl}); router and judge model: ${config.routerModel}`,
  );
});
