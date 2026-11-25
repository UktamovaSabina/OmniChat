export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  /** Aborts the call, e.g. when the browser disconnects. */
  signal?: AbortSignal;
}

/** One way of getting an answer from a model. MockProvider and OpenRouterProvider are interchangeable. */
export interface AiProvider {
  complete(modelId: string, messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
}

export type ProviderErrorCode =
  | 'not_configured'
  | 'payment_required'
  | 'model_unavailable'
  | 'rate_limited'
  | 'overloaded'
  | 'timeout'
  | 'connection'
  | 'upstream';

/** A provider failure with a message that is safe and useful to show in the UI. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number;

  constructor(code: ProviderErrorCode, message: string, status = 502) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}
