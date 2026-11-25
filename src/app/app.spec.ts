import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { App } from './app';
import { FakeApi, NO_DELAYS } from './core/testing';
import { EXAMPLES } from './core/copy';
import { UnifiedAiService } from './core/unified-ai.service';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: UnifiedAiService, useValue: new FakeApi() }, NO_DELAYS],
    }).compileComponents();
    fixture = TestBed.createComponent(App);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('renders the header, the empty state and the example prompts', async () => {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('.badge')?.textContent).toContain('Demo mode');
    });
    expect(el.querySelector('h1')?.textContent).toContain('Unified AI');
    expect(el.querySelector('header')?.textContent).toContain('by Team Unity');
    expect(el.querySelector('footer')?.textContent).toContain('by Team Unity');
    expect(el.querySelector('.empty h2')?.textContent).toContain('Ask anything, in any language');
    expect(el.querySelectorAll('.flow .step')).toHaveLength(5);
    expect(el.querySelectorAll('.chip')).toHaveLength(EXAMPLES.length);
    expect(el.querySelector('textarea')?.getAttribute('placeholder')).toBe(
      "Ask in English, O'zbekcha or Русский…",
    );
    expect(el.querySelector('app-sidebar')?.textContent).toContain(
      'Send a prompt to watch the router choose a model.',
    );
  });

  it('answers an example prompt, then learns from a vote', async () => {
    (el.querySelector('.chip') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('app-assistant-message .q')?.textContent).toContain(
        'Quality check: 91/100',
      );
    });

    const card = el.querySelector('app-assistant-message')!;
    expect(card.querySelectorAll('.step.done')).toHaveLength(5);
    // Spans in the routing row sit side by side (spaced by CSS gap), so their text runs together here.
    expect(card.querySelector('.route')?.textContent).toMatch(
      /^Coding\s*96% confident\s*· English\s*→\s*Claude/,
    );
    expect(card.querySelector('.route')?.textContent).toMatch(/score\s*95\s*vs ChatGPT 92/);
    expect(card.querySelector('.why')?.textContent).toBe(
      'Contains Python code and asks for a fix.',
    );
    expect(card.querySelector('.md code')?.textContent).toBe('range(10)');
    expect(el.querySelector('app-routing-panel .cat')?.textContent).toContain('Coding');

    const [up, down] = Array.from(card.querySelectorAll<HTMLButtonElement>('.fb button'));
    up.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('.toast')?.textContent).toContain(
        'Router learned: Claude · Coding 95 → 96',
      );
    });
    expect(up.disabled && down.disabled).toBe(true);
    expect(up.classList).toContain('sel');
  });

  it('shows the benchmark table with the last pick highlighted', async () => {
    (el.querySelector('.chip') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('app-assistant-message .q')).not.toBeNull();
    });
    (el.querySelector('#tab-benchmarks') as HTMLButtonElement).click();
    fixture.detectChanges();

    const pick = el.querySelector('app-benchmarks-panel td.pick');
    expect(pick?.textContent?.trim()).toBe('95');
    expect(pick?.classList).toContain('best');
  });
});
