import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  afterRenderEffect,
  inject,
  viewChild,
} from '@angular/core';
import { ChatStore } from '../core/chat-store';
import { EXAMPLES, FLOW } from '../core/copy';
import { Logo } from '../shared/logo';
import { AssistantMessage } from './assistant-message';
import { Composer } from './composer';

/** How close to the bottom (px) still counts as "following" the conversation. */
const STICK_THRESHOLD = 80;

@Component({
  selector: 'app-chat',
  imports: [AssistantMessage, Composer, Logo],
  template: `
    <div class="messages" #scroller (scroll)="onScroll()">
      <div class="inner">
        @for (turn of store.turns(); track turn.id) {
          @if (turn.kind === 'user') {
            <div class="msg user">
              <div class="bubble">{{ turn.text }}</div>
            </div>
          } @else {
            <app-assistant-message class="msg" [turn]="turn" />
          }
        } @empty {
          <div class="empty">
            <app-logo class="hero" [size]="58" />
            <h2>Ask anything, in any language</h2>
            <p>
              Unified AI works out what kind of task your prompt is, compares every model's
              benchmark scores for it, and sends it to the AI that's best at that task.
            </p>
            <div class="flow" aria-label="How Unified AI handles a prompt">
              @for (step of flow; track step; let i = $index, last = $last) {
                <span class="step"
                  ><b>{{ i + 1 }}</b> {{ step }}</span
                >
                @if (!last) {
                  <span aria-hidden="true">→</span>
                }
              }
            </div>
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
    <footer>Unified AI MVP · by Team Unity</footer>
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
      max-width: 780px;
      margin: 0 auto;
    }
    .empty {
      text-align: center;
      padding: 34px 10px 10px;
    }
    .hero {
      margin: 0 auto 14px;
      box-shadow: 0 10px 30px -10px #4f46e580;
    }
    .empty h2 {
      font-size: 27px;
      margin: 0 0 6px;
      letter-spacing: -0.02em;
    }
    .empty p {
      color: var(--muted);
      margin: 0 auto 20px;
      max-width: 540px;
    }
    .flow {
      display: flex;
      justify-content: center;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0 0 22px;
      font-size: 12.5px;
      color: var(--muted);
    }
    .flow .step {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 4px 9px;
    }
    .flow b {
      color: var(--accent);
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
    .chip:hover,
    .chip:focus-visible {
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
    footer {
      padding: 0 22px 10px;
      background: var(--bg);
      text-align: center;
      font-size: 11.5px;
      color: var(--muted);
    }
    @media (max-width: 979px) {
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
  protected readonly flow = FLOW;
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private following = true;

  constructor() {
    // After each render that changed the conversation, keep the newest content in view,
    // unless the reader has scrolled up to read something earlier.
    afterRenderEffect(() => {
      const last = this.store.turns().at(-1);
      if (last?.kind === 'bot') {
        last.step();
        last.result();
        last.error();
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
