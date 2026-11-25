import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ChatStore } from '../core/chat-store';

@Component({
  selector: 'app-stats-panel',
  template: `
    <div class="kpis">
      <div class="kpi">
        <b>{{ stats()?.totalRouted ?? 0 }}</b
        ><span>questions routed</span>
      </div>
      <div class="kpi">
        <b>{{ usage().length }}</b
        ><span>different AIs used</span>
      </div>
      <div class="kpi">
        <b>{{ stats()?.avgQuality ?? '—' }}</b
        ><span>avg quality score</span>
      </div>
      <div class="kpi">
        <b>{{ stats()?.feedbackCount ?? 0 }}</b
        ><span>feedback signals</span>
      </div>
    </div>

    <h3 class="section">Answers by model</h3>
    <div class="card">
      @for (u of usage(); track u.model) {
        <div class="stat">
          <span
            ><span class="dot" [style.background]="store.model(u.model).color"></span
            >{{ store.model(u.model).name }}</span
          >
          <b>{{ u.count }}</b>
        </div>
      } @empty {
        <p class="muted">No prompts yet.</p>
      }
    </div>
    <p class="tiny">{{ savings() }}</p>

    <button type="button" class="reset" (click)="store.resetLearning()">
      Reset stats and learned scores
    </button>
  `,
  styles: `
    .kpis {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 16px;
    }
    .kpi {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
    }
    .kpi b {
      display: block;
      font-size: 24px;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .kpi span {
      font-size: 12px;
      color: var(--muted);
    }
    .stat {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13.5px;
      padding: 6px 0;
      border-bottom: 1px dashed var(--line);
    }
    .stat:last-child {
      border-bottom: 0;
    }
    .stat .dot {
      margin-right: 7px;
    }
    .reset {
      margin-top: 14px;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 12.5px;
      color: var(--muted);
      cursor: pointer;
    }
    .reset:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatsPanel {
  protected readonly store = inject(ChatStore);
  protected readonly stats = this.store.stats;

  protected readonly usage = computed(() =>
    Object.entries(this.stats()?.byModel ?? {})
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count),
  );

  protected readonly savings = computed(() => {
    const n = this.usage().length;
    return n > 1
      ? `You used ${n} different AIs — that would be ${n} separate subscriptions (~$${n * 20}/month). With Unified AI it's one.`
      : 'Each AI used here would normally be a separate ~$20/month subscription.';
  });
}
