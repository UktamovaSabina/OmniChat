import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Chat } from './chat/chat';
import { ChatStore } from './core/chat-store';
import { Logo } from './shared/logo';
import { Sidebar } from './sidebar/sidebar';

@Component({
  selector: 'app-root',
  imports: [Chat, Logo, Sidebar],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly store = inject(ChatStore);
}
