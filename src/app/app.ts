import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Chat } from './chat/chat';
import { ChatStore } from './core/chat-store';
import { Logo } from './shared/logo';
import { Sidebar } from './sidebar/sidebar';

@Component({
  selector: 'app-root',
  imports: [Chat, FormsModule, Logo, Sidebar],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly store = inject(ChatStore);
  protected readonly keyPanelOpen = signal(false);
  protected keyDraft = '';

  protected toggleKeyPanel(): void {
    this.keyPanelOpen.update((open) => !open);
  }

  protected saveKey(): void {
    this.store.setApiKey(this.keyDraft);
    this.keyDraft = '';
    this.keyPanelOpen.set(false);
  }

  protected clearKey(): void {
    this.store.clearApiKey();
    this.keyDraft = '';
    this.keyPanelOpen.set(false);
  }
}
