import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

const MAX_HEIGHT = 160;

@Component({
  selector: 'app-composer',
  template: `
    <form (submit)="submit($event)">
      <textarea
        #box
        rows="1"
        aria-label="Your question"
        placeholder="Ask a question in any language…"
        [value]="text()"
        (input)="onInput(box)"
        (keydown.enter)="onEnter($event)"
      ></textarea>
      @if (busy()) {
        <button class="send" type="button" (click)="stop.emit()">Stop</button>
      } @else {
        <button class="send" type="submit" [disabled]="!text().trim()">Send</button>
      }
    </form>
  `,
  styles: `
    :host {
      display: block;
      padding: 12px 22px 18px;
      border-top: 1px solid var(--line);
      background: var(--bg);
    }
    form {
      max-width: 760px;
      margin: 0 auto;
      display: flex;
      gap: 10px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 8px 8px 8px 14px;
    }
    form:focus-within {
      border-color: var(--accent);
    }
    textarea {
      flex: 1;
      border: 0;
      outline: 0;
      resize: none;
      font: inherit;
      color: inherit;
      background: transparent;
      max-height: 160px;
      padding: 6px 0;
    }
    .send {
      border: 0;
      background: var(--accent);
      color: #fff;
      font-weight: 600;
      padding: 0 18px;
      border-radius: 11px;
      cursor: pointer;
    }
    .send:disabled {
      opacity: 0.5;
      cursor: default;
    }
    @media (max-width: 900px) {
      :host {
        padding: 10px 12px 14px;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Composer {
  readonly busy = input(false);
  readonly send = output<string>();
  readonly stop = output<void>();

  protected readonly text = signal('');
  private readonly box = viewChild.required<ElementRef<HTMLTextAreaElement>>('box');

  constructor() {
    // Put the cursor back in the box once an answer finishes, as the original did.
    let wasBusy = false;
    effect(() => {
      const busy = this.busy();
      if (wasBusy && !busy) this.box().nativeElement.focus();
      wasBusy = busy;
    });
  }

  protected onInput(box: HTMLTextAreaElement) {
    this.text.set(box.value);
    this.autosize();
  }

  protected onEnter(event: Event) {
    if ((event as KeyboardEvent).shiftKey || (event as KeyboardEvent).isComposing) return;
    event.preventDefault();
    this.submit();
  }

  protected submit(event?: Event) {
    event?.preventDefault();
    const value = this.text().trim();
    if (!value || this.busy()) return;
    this.send.emit(value);
    this.text.set('');
    // The [value] binding clears the box on the next render; reset its height now.
    this.box().nativeElement.value = '';
    this.autosize();
  }

  private autosize() {
    const el = this.box().nativeElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
  }
}
