import { ProviderError, type AiProvider, type ChatMessage, type CompleteOptions } from './provider';

interface GeminiReply {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
    finishReason?: string;
  }[];
  error?: {
    code?: number;
    status?: string;
    message?: string;
  };
}

interface GeminiModelsResponse {
  models?: {
    name?: string;
    supportedGenerationMethods?: string[];
  }[];
  error?: {
    code?: number;
    message?: string;
  };
}

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const EXCLUDED_MODEL_RE =
  /embed|imagen|veo|tts|audio|live|robotics|computer-use|aqa|bisect|native-audio|image/i;

/**
 * Calls Google's Gemini REST API directly from the browser so no backend server is needed.
 */
export class GeminiProvider implements AiProvider {
  static readonly #resolvedByKey = new Map<string, string>();

  readonly #apiKey: string;
  readonly #timeoutMs: number;

  constructor(options: { apiKey: string; timeoutMs?: number }) {
    this.#apiKey = options.apiKey.trim();
    this.#timeoutMs = options.timeoutMs ?? 60_000;
  }

  static clearCache(): void {
    GeminiProvider.#resolvedByKey.clear();
  }

  async complete(
    modelId: string,
    messages: ChatMessage[],
    options: CompleteOptions = {},
  ): Promise<string> {
    if (!this.#apiKey) {
      throw new ProviderError(
        'not_configured',
        'No Gemini API key is set. Click "API key" in the header to add one.',
      );
    }

    let activeModel =
      GeminiProvider.#resolvedByKey.get(this.#apiKey) ??
      (modelId === 'auto' ? await this.discoverModel(options.signal) : modelId);

    try {
      return await this.callGenerateContent(activeModel, messages, options);
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'model_unavailable') {
        GeminiProvider.#resolvedByKey.delete(this.#apiKey);
        const fallback = await this.discoverModel(options.signal, activeModel);
        if (fallback && fallback !== activeModel) {
          activeModel = fallback;
          return await this.callGenerateContent(activeModel, messages, options);
        }
      }
      throw err;
    }
  }

  private async discoverModel(signal?: AbortSignal, excludeModel?: string): Promise<string> {
    const { status, body } = await this.fetchJson<GeminiModelsResponse>(
      `${GEMINI_BASE_URL}?pageSize=100`,
      {
        method: 'GET',
        headers: { 'x-goog-api-key': this.#apiKey },
      },
      'gemini-models',
      signal,
    );

    if (status >= 400 || body?.error) {
      throw toProviderError(body?.error?.code || status, body?.error?.message ?? '', 'models');
    }

    const candidates = (body?.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => (m.name ?? '').replace(/^models\//, '').trim())
      .filter((id) => id && id !== excludeModel && id.startsWith('gemini') && !EXCLUDED_MODEL_RE.test(id));

    if (candidates.length === 0) {
      throw new ProviderError(
        'model_unavailable',
        'No compatible Gemini text model was found for this API key.',
      );
    }

    const chosen = pickBestGeminiModel(candidates);
    GeminiProvider.#resolvedByKey.set(this.#apiKey, chosen);
    return chosen;
  }

  private async callGenerateContent(
    modelId: string,
    messages: ChatMessage[],
    options: CompleteOptions,
  ): Promise<string> {
    const systemParts = messages
      .filter((m) => m.role === 'system' && m.content.trim())
      .map((m) => ({ text: m.content }));

    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const generationConfig: Record<string, number> = {};
    if (options.temperature !== undefined) generationConfig['temperature'] = options.temperature;
    if (options.maxTokens !== undefined) generationConfig['maxOutputTokens'] = options.maxTokens;

    const payload: Record<string, unknown> = { contents };
    if (systemParts.length > 0) payload['systemInstruction'] = { parts: systemParts };
    if (Object.keys(generationConfig).length > 0) payload['generationConfig'] = generationConfig;

    const { status, body } = await this.fetchJson<GeminiReply>(
      `${GEMINI_BASE_URL}/${encodeURIComponent(modelId)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.#apiKey,
        },
        body: JSON.stringify(payload),
      },
      modelId,
      options.signal,
    );

    if (status >= 400 || body?.error) {
      throw toProviderError(body?.error?.code || status, body?.error?.message ?? '', modelId);
    }

    const text = body?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim();

    if (!text) {
      throw new ProviderError('upstream', `Gemini (${modelId}) sent an empty answer. Try again.`);
    }
    return text;
  }

  private async fetchJson<T>(
    url: string,
    init: RequestInit,
    modelLabel: string,
    externalSignal?: AbortSignal,
  ): Promise<{ status: number; body: T | null }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    const onExternalAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const body = (await res.json().catch(() => null)) as T | null;
      return { status: res.status, body };
    } catch (err) {
      if (externalSignal?.aborted) throw err;
      if (timedOut) {
        throw new ProviderError(
          'timeout',
          `Gemini (${modelLabel}) took too long to answer. Try again.`,
        );
      }
      throw new ProviderError(
        'connection',
        "Couldn't reach the Gemini API. Check your internet connection or browser extensions.",
      );
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

export function pickBestGeminiModel(models: string[]): string {
  return [...models].sort((a, b) => scoreModel(b) - scoreModel(a))[0];
}

function scoreModel(id: string): number {
  const verMatch = /gemini-(\d+(?:\.\d+)?)/.exec(id);
  const version = verMatch ? Number(verMatch[1]) : 0;
  let score = version * 100;
  if (id.includes('flash')) score += 40;
  else if (id.includes('pro')) score += 20;
  if (id.includes('lite')) score -= 10;
  if (/preview|exp/.test(id)) score -= 5;
  if (id.includes('latest')) score += 1;
  return score;
}

function toProviderError(status: number, upstreamMessage: string, modelId: string): ProviderError {
  if (
    status === 401 ||
    status === 403 ||
    (status === 400 && /api[_ ]?key/i.test(upstreamMessage))
  ) {
    return new ProviderError(
      'not_configured',
      'Gemini rejected the API key. Check your key in the header and try again.',
    );
  }
  if (status === 404) {
    return new ProviderError(
      'model_unavailable',
      `Gemini model "${modelId}" was not found. Update GEMINI_MODEL in gemini.config.ts.`,
    );
  }
  if (status === 429) {
    return new ProviderError(
      'rate_limited',
      'Gemini API rate limit reached. Wait a moment and try again.',
    );
  }
  if (status >= 500) {
    return new ProviderError(
      'overloaded',
      'Gemini is temporarily busy or unavailable. Try again shortly.',
    );
  }
  const detail = upstreamMessage ? `: ${upstreamMessage.slice(0, 200)}` : '';
  return new ProviderError('upstream', `Gemini returned an error (${status}${detail}).`);
}
