import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ChatStore } from '../core/chat-store';
import { CATEGORIES, MODELS } from '../core/routing';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sidebar {
  protected readonly store = inject(ChatStore);
  protected readonly models = MODELS;
  protected readonly categories = CATEGORIES;
  protected readonly decision = computed(() => {
    const d = this.store.lastDecision();
    return d ? [d] : [];
  });
}
