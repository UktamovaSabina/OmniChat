import { ChangeDetectionStrategy, Component, type ElementRef, afterRenderEffect, inject, viewChild } from '@angular/core';
import { ChatStore } from '../core/chat-store';
import { EXAMPLES } from '../core/routing';
import { BotMessage } from './bot-message';
import { Composer } from './composer';

/** How close to the bottom (px) still counts as "following" the conversation. */
const STICK_THRESHOLD = 80;

@Component({
  selector: 'app-chat',
  imports: [BotMessage, Composer],
  template: `
    <div class="messages" #scroller (scroll)="onScroll()">
      <div class="inner">
        @for (turn of store.turns(); track turn.id) {
          @if (turn.kind === 'user') {
            <div class="msg user"><div class="bubble">{{ turn.text }}</div></div>
          } @else {
            <app-bot-message class="msg" [turn]="turn" />
          }
        } @empty {
          <div class="empty">
            <h2>Ask anything</h2>
            <p>OmniChat reads your question and sends it to the AI that scores best for that kind of task.</p>
            <div class="chips">
              @for (example of examples; track example) {
                <button type="button" class="chip" (click)="ask(example)">{{ example }}</button>
              }
            </div>
          </div>
        }
      </div>
    </div>
    <app-composer [busy]="store.busy()" (send)="ask($event)" (stop)="store.stop()" />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 24px 22px 8px;
    }
    .inner {
      max-width: 760px;
      margin: 0 auto;
    }
    .empty {
      text-align: center;
      padding: 40px 10px 10px;
    }
    .empty h2 {
      font-size: 24px;
      margin: 0 0 6px;
      letter-spacing: -0.02em;
    }
    .empty p {
      color: var(--muted);
      margin: 0 0 22px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
    }
    .chip {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 999px;
      padding: 8px 14px;
      font-size: 13.5px;
      cursor: pointer;
      color: var(--ink);
    }
    .chip:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .msg {
      margin: 0 0 18px;
    }
    .user {
      display: flex;
      justify-content: flex-end;
    }
    .bubble {
      background: var(--accent);
      color: #fff;
      padding: 10px 14px;
      border-radius: 16px 16px 4px 16px;
      max-width: 80%;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    @media (max-width: 900px) {
      .messages {
        padding: 16px 12px 6px;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Chat {
  protected readonly store = inject(ChatStore);
  protected readonly examples = EXAMPLES;
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private following = true;

  constructor() {
    // After each render that changed the conversation, keep the newest content in view,
    // unless the reader has scrolled up to read something earlier.
    afterRenderEffect(() => {
      const last = this.store.turns().at(-1);
      if (last?.kind === 'bot') {
        last.route();
        last.status();
        last.text();
        last.note();
      }
      if (this.following) {
        const el = this.scroller().nativeElement;
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  protected ask(question: string) {
    this.following = true;
    void this.store.submit(question);
  }

  protected onScroll() {
    const el = this.scroller().nativeElement;
    this.following = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  }
}
