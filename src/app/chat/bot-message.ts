import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { BotTurn } from '../core/chat-store';
import { CATEGORIES, MODELS } from '../core/routing';
import { MarkdownPipe } from '../shared/markdown.pipe';

@Component({
  selector: 'app-bot-message',
  imports: [MarkdownPipe],
  template: `
    <div class="route">
      @if (route(); as r) {
        <span>{{ categoryLabel() }}</span>
        <span aria-hidden="true">→</span>
        <span class="pill" [style.--c]="winner()?.color">
          <span class="dot"></span>{{ winner()?.name }}
        </span>
        <span>score {{ r.ranked[0].score }}</span>
      } @else {
        <span class="thinking">Routing your question…</span>
      }
    </div>

    <div class="body" aria-live="polite">
      @switch (turn().status()) {
        @case ('routing') {}
        @case ('error') {
          <p class="thinking">{{ turn().error() }}</p>
        }
        @default {
          @if (turn().text()) {
            <div class="md" [innerHTML]="turn().text() | markdown"></div>
          } @else if (turn().status() === 'answering') {
            <p class="thinking">{{ winner()?.name }} is answering…</p>
          }
        }
      }
    </div>

    @if (turn().note()) {
      <div class="note">{{ turn().note() }}</div>
    }
  `,
  styles: `
    :host {
      display: block;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .route {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
      background: #fbfbfe;
      font-size: 13px;
      color: var(--muted);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      font-weight: 600;
      font-size: 12.5px;
      color: var(--c);
      background: color-mix(in srgb, var(--c) 14%, white);
    }
    .pill .dot {
      background: var(--c);
    }
    .body {
      padding: 12px 16px 14px;
    }
    .body:empty {
      display: none;
    }
    .body p {
      margin: 0.4em 0;
    }
    .note {
      font-size: 12px;
      color: var(--muted);
      padding: 0 16px 12px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BotMessage {
  readonly turn = input.required<BotTurn>();

  protected readonly route = computed(() => this.turn().route());
  protected readonly winner = computed(() => {
    const r = this.route();
    return r ? MODELS[r.winner] : null;
  });
  protected readonly categoryLabel = computed(() => {
    const r = this.route();
    return r ? CATEGORIES[r.category].label : '';
  });
}
