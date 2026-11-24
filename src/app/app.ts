import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Chat } from './chat/chat';
import { Sidebar } from './sidebar/sidebar';

@Component({
  selector: 'app-root',
  imports: [Chat, Sidebar],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
