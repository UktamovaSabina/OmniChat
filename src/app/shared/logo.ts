import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The Unified AI mark: one hub with every model around it, on the accent gradient. */
@Component({
  selector: 'app-logo',
  template: `
    <svg
      [attr.width]="size() * 0.56"
      [attr.height]="size() * 0.56"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      stroke-width="2.3"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 2v5M12 17v5M2 12h5M17 12h5M4.9 4.9l3.5 3.5M15.6 15.6l3.5 3.5M4.9 19.1l3.5-3.5M15.6 8.4l3.5-3.5"
      />
    </svg>
  `,
  host: {
    role: 'img',
    'aria-label': 'Unified AI logo',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.border-radius.px]': 'size() * 0.3',
  },
  styles: `
    :host {
      display: grid;
      place-items: center;
      flex: none;
      background: var(--accent-gradient);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Logo {
  readonly size = input(36);
}
