import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { BenchmarksPanel } from './benchmarks-panel';
import { RoutingPanel } from './routing-panel';
import { StatsPanel } from './stats-panel';

type TabId = 'routing' | 'benchmarks' | 'stats';

@Component({
  selector: 'app-sidebar',
  imports: [BenchmarksPanel, RoutingPanel, StatsPanel],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sidebar {
  protected readonly tabs: readonly { id: TabId; label: string }[] = [
    { id: 'routing', label: 'Routing' },
    { id: 'benchmarks', label: 'Benchmarks' },
    { id: 'stats', label: 'Stats' },
  ];
  protected readonly tab = signal<TabId>('routing');

  /** Arrow keys move between tabs, as in the ARIA tabs pattern. */
  protected onKeydown(event: KeyboardEvent) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const i = this.tabs.findIndex((t) => t.id === this.tab());
    const next = this.tabs[(i + step + this.tabs.length) % this.tabs.length];
    this.tab.set(next.id);
    (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`#tab-${next.id}`)?.focus();
  }
}
