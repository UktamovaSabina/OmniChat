import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ChatStore, type BotTurn } from '../core/chat-store';
import { PIPELINE_STEPS, STEP, WAITING_TEXT } from '../core/copy';
import { MarkdownPipe } from '../shared/markdown.pipe';

type StepState = 'idle' | 'active' | 'done' | 'failed';

@Component({
  selector: 'app-assistant-message',
  imports: [MarkdownPipe],
  template: `
    <ol class="pipe" aria-label="Pipeline progress">
      @for (label of steps; track label; let i = $index) {
        <li class="step" [class]="stepState(i)">{{ label }}</li>
      }
    </ol>

    @if (result(); as r) {
      <div class="route">
        <span class="tag">{{ r.routing.categoryLabel }}</span>
        <span>{{ r.routing.confidence }}% confident</span>
        <span>· {{ r.routing.language }}</span>
        <span aria-hidden="true">→</span>
        <span class="pill" [style.--c]="winner().color"
          ><span class="dot"></span>{{ winner().name }}</span
        >
        <span>
          score <b>{{ r.routing.ranking[0].score }}</b>
          @if (runnerUp(); as ru) {
            vs {{ store.model(ru.model).name }} {{ ru.score }}
          }
        </span>
        <span class="why">{{ r.routing.reason }}</span>
      </div>
    }

    <div class="body" aria-live="polite">
      @if (result(); as r) {
        <div class="md" [innerHTML]="r.answer | markdown"></div>
      } @else if (turn().status() === 'pending') {
        <p class="thinking">{{ waitingText() }}</p>
      } @else {
        <p class="thinking">{{ turn().error() }}</p>
      }
    </div>

    @if (result(); as r) {
      <div class="foot">
        @if (turn().step() < done) {
          <span class="thinking">Running quality check…</span>
        } @else {
          <span class="q">
            Quality check: {{ r.quality.score }}/100
            <span class="qbar" aria-hidden="true"><i [style.width.%]="r.quality.score"></i></span>
          </span>
          <span>{{ r.quality.verdict }}</span>
          <span class="fb">
            <button
              type="button"
              title="Good answer"
              aria-label="Good answer"
              [attr.aria-pressed]="turn().vote() === 1"
              [class.sel]="turn().vote() === 1"
              [disabled]="turn().vote() !== null"
              (click)="store.vote(turn(), 1)"
            >
              👍
            </button>
            <button
              type="button"
              title="Bad answer"
              aria-label="Bad answer"
              [attr.aria-pressed]="turn().vote() === -1"
              [class.sel]="turn().vote() === -1"
              [disabled]="turn().vote() !== null"
              (click)="store.vote(turn(), -1)"
            >
              👎
            </button>
          </span>
          @if (standIn(); as s) {
            <span class="note">{{ s }}</span>
          }
        }
      </div>
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
    .pipe {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0;
      padding: 10px 14px;
      list-style: none;
      border-bottom: 1px solid var(--line);
      background: #fbfbfe;
    }
    .step {
      font-size: 12px;
      padding: 3px 9px;
      border-radius: 999px;
      background: #eef0f5;
      color: #8a90a6;
      transition:
        background 0.3s,
        color 0.3s;
    }
    .step.active {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 600;
    }
    .step.done {
      background: #e8f7ee;
      color: var(--good);
      font-weight: 600;
    }
    .step.failed {
      background: #fdecec;
      color: var(--bad);
      font-weight: 600;
    }
    .route {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
      font-size: 13px;
      color: var(--muted);
    }
    .route b {
      color: var(--ink);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 12.5px;
      color: var(--c);
      background: color-mix(in srgb, var(--c) 14%, white);
    }
    .pill .dot {
      background: var(--c);
    }
    .why {
      flex-basis: 100%;
      font-size: 12.5px;
    }
    .body {
      padding: 12px 16px 10px;
    }
    .body p {
      margin: 0.4em 0;
    }
    .foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      padding: 8px 14px 12px;
      font-size: 12.5px;
      color: var(--muted);
    }
    .q {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      color: var(--ink);
    }
    .qbar {
      width: 70px;
      height: 6px;
      background: #eef0f5;
      border-radius: 99px;
      overflow: hidden;
    }
    .qbar i {
      display: block;
      height: 100%;
      background: var(--good);
      border-radius: 99px;
    }
    .fb {
      margin-left: auto;
      display: flex;
      gap: 6px;
    }
    .fb button {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 3px 10px;
      cursor: pointer;
      font-size: 14px;
    }
    .fb button:hover:not(:disabled) {
      border-color: var(--accent);
    }
    .fb button.sel {
      background: var(--accent-soft);
      border-color: var(--accent);
    }
    .fb button:disabled:not(.sel) {
      opacity: 0.45;
    }
    .fb button:disabled {
      cursor: default;
    }
    .note {
      flex-basis: 100%;
      font-size: 11.5px;
    }
    @media (prefers-reduced-motion: reduce) {
      .step {
        transition: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantMessage {
  protected readonly store = inject(ChatStore);
  readonly turn = input.required<BotTurn>();

  protected readonly steps = PIPELINE_STEPS;
  protected readonly done = STEP.done;

  protected readonly result = computed(() => this.turn().result());
  protected readonly winner = computed(() =>
    this.store.model(this.result()?.routing.selectedModel ?? ''),
  );
  protected readonly runnerUp = computed(() => this.result()?.routing.ranking[1] ?? null);
  protected readonly waitingText = computed(
    () => WAITING_TEXT[Math.min(this.turn().step(), STEP.answering)],
  );

  /** Explains when another model answered in place of the router's pick (DALL·E in openrouter mode). */
  protected readonly standIn = computed(() => {
    const r = this.result();
    if (!r?.answeredBy) return '';
    const picked = this.store.model(r.routing.selectedModel).name;
    return `${picked} isn't available through OpenRouter, so ${this.store.model(r.answeredBy).name} answered in its place.`;
  });

  protected stepState(index: number): StepState {
    const step = this.turn().step();
    const status = this.turn().status();
    if (index < step) return 'done';
    if (index > step) return 'idle';
    if (status === 'error' || status === 'stopped') return 'failed';
    return 'active';
  }
}
