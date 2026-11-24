import { Injectable } from '@angular/core';
import type { Category } from './routing';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface Classification {
  category: Category;
  reason: string;
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'done'; model: string; stopReason: string | null }
  | { type: 'error'; code: string; message: string };

/** An error from the OmniChat server, with a machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Talks to the OmniChat Node server (server/index.ts). In development, /api is
 * proxied there by proxy.conf.json, so the API key never reaches the browser.
 */
@Injectable({ providedIn: 'root' })
export class OmniChatApi {
  async classify(question: string): Promise<Classification> {
    const res = await this.post('/api/classify', { question });
    return (await res.json()) as Classification;
  }

  /** Yields the answer as it streams in. Throws ApiError if the request can't start. */
  async *streamChat(messages: ChatTurn[], category: Category, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const res = await this.post('/api/chat', { messages, category }, signal);
    if (!res.body) throw new ApiError('connection', 'The server sent an empty response.');

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as StreamEvent;
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer) as StreamEvent;
  }

  private async post(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ApiError('offline', "Can't reach the OmniChat server. Start it with `npm start`.");
    }
    if (res.ok) return res;

    const data = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    if (data?.code) throw new ApiError(data.code, data.message ?? 'Request failed.');
    // No JSON body: usually the dev-server proxy reporting that the API server is down.
    throw new ApiError('offline', "Can't reach the OmniChat server. Start it with `npm start`.");
  }
}
