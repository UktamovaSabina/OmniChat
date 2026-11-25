import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ChatStore } from '../core/chat-store';
import { HOW_IT_WORKS } from '../core/copy';
import { SignedPipe } from '../shared/signed.pipe';

@Component({
  selector: 'app-routing-panel',
  imports: [SignedPipe],
  template: `
    <h3 class="section">Last routing decision</h3>
    <div class="card" aria-live="polite">
      <!-- A one-item list keyed by turn, so each new decision re-creates the bars and replays their animation. -->
      @for (d of decision(); track d.turnId) {
        <div class="cat">{{ d.routing.categoryLabel }}</div>
        <div class="meta">
          <span class="tag">{{ d.routing.confidence }}% confident</span>
          <span class="tag">{{ d.routing.language }}</span>
          <span class="tag">{{
            d.routing.classifiedBy === 'ai' ? 'AI router' : 'Keyword rules'
          }}</span>
        </div>
        <p class="muted reason">{{ d.routing.reason }}</p>

        @for (r of bars(); track r.model; let first = $first) {
          <div class="bar">
            <div class="lbl">
              <span [class.win]="first">
                @if (first) {
                  ✓
                }
                {{ store.model(r.model).name }}
                @if (r.learnedAdjustment) {
                  <span class="adj" [class.neg]="r.learnedAdjustment < 0">{{
                    r.learnedAdjustment | signed
                  }}</span>
                }
              </span>
              <span [class.win]="first">{{ r.score }}</span>
            </div>
            <div class="track">
              <div
                class="fill"
                [style.width.%]="r.score"
                [style.background]="store.model(r.model).color"
              ></div>
            </div>
          </div>
        }

        @if (newLeader(); as name) {
          <p class="tiny learned">
            After feedback, {{ name }} now ranks first for {{ d.routing.categoryLabel }}.
          </p>
        }
        <p class="tiny">
          Highest score wins; on a tie, the cheaper model wins. Took {{ seconds(d.timings) }} s:
          understand {{ d.timings.classifyMs }} ms, answer {{ d.timings.answerMs }} ms, check
          {{ d.timings.judgeMs }} ms.
        </p>
      } @empty {
        <p class="muted">Send a prompt to watch the router choose a model.</p>
      }
    </div>

    <h3 class="section">How it works</h3>
    <div class="card">
      <ol class="how">
        @for (s of howItWorks; track s.title) {
          <li>
            <b>{{ s.title }}:</b> {{ s.text }}
          </li>
        }
      </ol>
    </div>
  `,
  styles: `
    .cat {
      font-weight: 800;
      font-size: 16px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 6px 0 4px;
    }
    .reason {
      margin: 6px 0 4px;
    }
    .bar {
      margin: 10px 0;
    }
    .lbl {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      margin-bottom: 3px;
    }
    .track {
      height: 8px;
      background: #eef0f5;
      border-radius: 99px;
      overflow: hidden;
    }
    .fill {
      height: 100%;
      border-radius: 99px;
      /* Grows from 0 when a new decision renders, and slides when feedback changes a score. */
      animation: grow 0.6s ease-out;
      transition: width 0.6s ease-out;
    }
    @keyframes grow {
      from {
        width: 0;
      }
    }
    .win {
      font-weight: 800;
    }
    .learned {
      color: var(--good);
    }
    .how {
      padding-left: 18px;
      margin: 0;
      font-size: 13.5px;
    }
    .how li {
      margin: 0 0 7px;
    }
    @media (prefers-reduced-motion: reduce) {
      .fill {
        animation: none;
        transition: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoutingPanel {
  protected readonly store = inject(ChatStore);
  protected readonly howItWorks = HOW_IT_WORKS;

  protected readonly decision = computed(() => {
    const d = this.store.lastDecision();
    return d ? [d] : [];
  });

  /** Current scores for the last decision's task, so votes show up here as soon as they land. */
  protected readonly bars = computed(() => {
    const d = this.store.lastDecision();
    if (!d) return [];
    return this.store.benchmarks()?.categories[d.routing.category]?.ranking ?? d.routing.ranking;
  });

  /** Set when learning has changed which model would win this task since the decision was made. */
  protected readonly newLeader = computed(() => {
    const d = this.store.lastDecision();
    const leader = this.bars()[0]?.model;
    return d && leader && leader !== d.routing.selectedModel ? this.store.model(leader).name : '';
  });

  protected seconds(t: { classifyMs: number; answerMs: number; judgeMs: number }): string {
    return ((t.classifyMs + t.answerMs + t.judgeMs) / 1000).toFixed(1);
  }
}
