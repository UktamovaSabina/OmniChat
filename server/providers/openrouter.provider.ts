import {
  ProviderError,
  type AiProvider,
  type ChatMessage,
  type CompleteOptions,
} from './provider.ts';

interface OpenRouterReply {
  choices?: { message?: { content?: string | null } }[];
  error?: { code?: number | string; message?: string };
}

/**
 * Real models through OpenRouter's OpenAI-compatible Chat Completions API:
 * POST {baseUrl}/chat/completions with "Authorization: Bearer <key>".
 */
export class OpenRouterProvider implements AiProvider {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(options: { apiKey: string; baseUrl: string; timeoutMs?: number }) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? 90_000;
  }

  async complete(
    modelId: string,
    messages: ChatMessage[],
    options: CompleteOptions = {},
  ): Promise<string> {
    const signals = [AbortSignal.timeout(this.#timeoutMs)];
    if (options.signal) signals.push(options.signal);

    let body: OpenRouterReply | null;
    let status: number;
    try {
      const res = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Unified AI',
        },
        body: JSON.stringify({
          model: modelId,
          messages,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
        }),
        signal: AbortSignal.any(signals),
      });
      status = res.status;
      body = (await res.json().catch(() => null)) as OpenRouterReply | null;
    } catch (err) {
      if (options.signal?.aborted) throw err; // the browser went away; nothing to report
      if ((err as Error).name === 'TimeoutError') {
        throw new ProviderError('timeout', `${modelId} took too long to answer. Try again.`, 504);
      }
      throw new ProviderError(
        'connection',
        "The server couldn't reach OpenRouter. Check the internet connection and OPENROUTER_BASE_URL.",
      );
    }

    // OpenRouter can also report an error inside a 200 response.
    if (status >= 400 || body?.error) {
      throw toProviderError(
        Number(body?.error?.code) || status,
        body?.error?.message ?? '',
        modelId,
      );
    }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new ProviderError('upstream', `${modelId} sent an empty answer. Try again.`);
    }
    return content.trim();
  }
}

function toProviderError(status: number, upstreamMessage: string, modelId: string): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError(
      'not_configured',
      'OpenRouter rejected the API key. Check OPENROUTER_API_KEY in .env and restart the server.',
      503,
    );
  }
  if (status === 402) {
    return new ProviderError(
      'payment_required',
      'The OpenRouter account is out of credits. Add credits at openrouter.ai, or switch to UNIFIED_AI_MODE=mock.',
      402,
    );
  }
  if (status === 404 || (status === 400 && /model/i.test(upstreamMessage))) {
    return new ProviderError(
      'model_unavailable',
      `OpenRouter can't find the model "${modelId}". Update its openrouterId in server/data/benchmarks.json (see openrouter.ai/models).`,
    );
  }
  if (status === 429) {
    return new ProviderError(
      'rate_limited',
      'OpenRouter is rate-limiting requests. Wait a moment and try again.',
      429,
    );
  }
  if (status >= 500) {
    return new ProviderError(
      'overloaded',
      `${modelId} is busy or unavailable right now. Try again shortly.`,
      503,
    );
  }
  const detail = upstreamMessage ? `: ${upstreamMessage.slice(0, 200)}` : '';
  return new ProviderError('upstream', `OpenRouter returned an error (${status}${detail}).`);
}
