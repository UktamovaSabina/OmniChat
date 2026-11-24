import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { EXAMPLES } from './core/routing';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('renders the header, empty state and example chips', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h1')?.textContent).toContain('OmniChat');
    expect(el.querySelector('.empty h2')?.textContent).toContain('Ask anything');
    expect(el.querySelectorAll('.chip')).toHaveLength(EXAMPLES.length);
    expect(el.querySelector('app-sidebar')?.textContent).toContain('Send a question to see how the router picks a model.');
  });
});
