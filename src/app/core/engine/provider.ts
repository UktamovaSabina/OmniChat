export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

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

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}
