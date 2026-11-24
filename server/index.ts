import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import {
  ANSWER_MODEL,
  CATEGORY_IDS,
  CLASSIFIER_MODEL,
  classify,
  streamAnswer,
  toPublicError,
  type Category,
  type ChatTurn,
} from './claude.ts';

const PORT = Number(process.env['PORT'] || 3000);
const MAX_MESSAGE_CHARS = 20_000;
const MAX_TURNS = 40;

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, answerModel: ANSWER_MODEL, classifierModel: CLASSIFIER_MODEL });
});

app.post('/api/classify', async (req: Request, res: Response) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question || question.length > MAX_MESSAGE_CHARS) {
    res.status(400).json({ code: 'bad_request', message: 'Send a non-empty "question" string.' });
    return;
  }
  try {
    const result = await classify(question);
    if (!result) {
      res.status(422).json({ code: 'unclassified', message: 'The classifier gave no usable answer.' });
      return;
    }
    res.json(result);
  } catch (err) {
    const e = toPublicError(err);
    logError('classify', err);
    res.status(e.status).json(e);
  }
});

/**
 * Streams the answer as newline-delimited JSON:
 *   {"type":"text","delta":"..."}                       repeated
 *   {"type":"done","model":"...","stopReason":"..."}    or
 *   {"type":"error","code":"...","message":"..."}
 */
app.post('/api/chat', async (req: Request, res: Response) => {
  const parsed = parseChatBody(req.body);
  if (typeof parsed === 'string') {
    res.status(400).json({ code: 'bad_request', message: parsed });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (event: object) => res.write(JSON.stringify(event) + '\n');

  let stream: ReturnType<typeof streamAnswer> | undefined;
  // Stop generating (and paying for) tokens if the browser goes away mid-answer.
  res.on('close', () => {
    if (!res.writableEnded) stream?.abort();
  });

  try {
    stream = streamAnswer(parsed.messages, parsed.category);
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        send({ type: 'text', delta: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      send({ type: 'error', code: 'refusal', message: 'The model declined to answer this request.' });
    } else {
      send({ type: 'done', model: final.model, stopReason: final.stop_reason });
    }
  } catch (err) {
    if (res.destroyed) return; // client disconnected; nothing to report
    logError('chat', err);
    const { code, message } = toPublicError(err);
    send({ type: 'error', code, message });
  }
  res.end();
});

function parseChatBody(body: unknown): { messages: ChatTurn[]; category: Category } | string {
  if (!body || typeof body !== 'object') return 'Expected a JSON body.';
  const { messages, category } = body as { messages?: unknown; category?: unknown };
  if (!Array.isArray(messages) || messages.length === 0) return '"messages" must be a non-empty array.';

  const turns: ChatTurn[] = [];
  for (const m of messages) {
    const role = (m as ChatTurn | null)?.role;
    const content = (m as ChatTurn | null)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) {
      return 'Each message needs role "user" or "assistant" and non-empty string content.';
    }
    if (content.length > MAX_MESSAGE_CHARS) return `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`;
    turns.push({ role, content });
  }
  if (turns.at(-1)?.role !== 'user') return 'The last message must come from the user.';

  // Keep the most recent turns, starting on a user message as the API requires.
  let recent = turns.slice(-MAX_TURNS);
  const firstUser = recent.findIndex((t) => t.role === 'user');
  recent = recent.slice(firstUser);

  const cat = CATEGORY_IDS.includes(category as Category) ? (category as Category) : 'general';
  return { messages: recent, category: cat };
}

function logError(where: string, err: unknown) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[${where}] ${msg}`);
}

// Serve the production build of the Angular app when it exists (npm run build).
const browserDir = path.resolve(import.meta.dirname, '../dist/omnichat/browser');
if (existsSync(browserDir)) {
  app.use(express.static(browserDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(browserDir, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`OmniChat API listening on http://localhost:${PORT}`);
  console.log(`  answers: ${ANSWER_MODEL} · classifier: ${CLASSIFIER_MODEL}`);
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.log('  ANTHROPIC_API_KEY is not set; the SDK will look for other credentials (e.g. `ant auth login`).');
  }
});
