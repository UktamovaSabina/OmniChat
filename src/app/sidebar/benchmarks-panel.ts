import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ChatStore } from '../core/chat-store';
import { SignedPipe } from '../shared/signed.pipe';

@Component({
  selector: 'app-benchmarks-panel',
  imports: [SignedPipe],
  template: `
    <h3 class="section">Benchmark scores (out of 100)</h3>
    @if (store.benchmarks(); as b) {
      <div class="card table-card">
        <table>
          <thead>
            <tr>
              <th scope="col">Task</th>
              @for (m of modelIds(); track m) {
                <th scope="col">
                  <span class="dot" [style.background]="b.models[m].color"></span>
                  <span class="name">{{ b.models[m].name }}</span>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (c of categoryIds(); track c) {
              @let row = b.categories[c];
              <tr [class.hl]="picked()?.category === c">
                <th scope="row" [title]="row.label">{{ row.short }}</th>
                @for (m of modelIds(); track m) {
                  @let score = row.effective[m];
                  @if (score === undefined) {
                    <td class="none" title="No score for this task">—</td>
                  } @else {
                    <td
                      [class.best]="row.best === m"
                      [class.pick]="picked()?.category === c && picked()?.model === m"
                      [title]="b.models[m].name + ' · ' + row.label + ': ' + score"
                    >
                      {{ score }}
                      @if (row.adjustments[m]; as adj) {
                        <span class="adj" [class.neg]="adj < 0">{{ adj | signed }}</span>
                      }
                    </td>
                  }
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="tiny">
        <b>Bold</b> is the best model for each task. The filled cell is the model picked for your
        last prompt. Green and red numbers are what the router learned from 👍 and 👎.
      </p>
      <p class="tiny">
        Sample scores — production uses public leaderboards plus our own Uzbek/Russian tests.
      </p>
    } @else {
      <p class="muted">Loading benchmark scores…</p>
    }
  `,
  styles: `
    .table-card {
      padding: 6px 6px 2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
      font-variant-numeric: tabular-nums;
    }
    th,
    td {
      padding: 7px 4px;
      text-align: center;
      border-bottom: 1px solid var(--line);
    }
    tr:last-child > * {
      border-bottom: 0;
    }
    thead th {
      font-size: 10.5px;
      color: var(--muted);
      font-weight: 600;
      vertical-align: bottom;
    }
    thead .dot {
      display: block;
      margin: 0 auto 3px;
    }
    th[scope='row'] {
      text-align: left;
      font-weight: 700;
    }
    thead th:first-child {
      text-align: left;
    }
    tr.hl > * {
      background: #f5f6ff;
    }
    td.best {
      font-weight: 800;
    }
    td.pick {
      background: var(--accent) !important;
      color: #fff;
      border-radius: 6px;
    }
    td.pick .adj {
      color: #fff;
    }
    td.none {
      color: #c0c4d2;
    }
    td .adj {
      display: block;
      line-height: 1.1;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BenchmarksPanel {
  protected readonly store = inject(ChatStore);
  protected readonly modelIds = computed(() => Object.keys(this.store.benchmarks()?.models ?? {}));
  protected readonly categoryIds = computed(() =>
    Object.keys(this.store.benchmarks()?.categories ?? {}),
  );
  protected readonly picked = computed(() => {
    const d = this.store.lastDecision();
    return d ? { category: d.routing.category, model: d.routing.selectedModel } : null;
  });
}
