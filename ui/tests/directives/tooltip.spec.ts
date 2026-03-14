import type { DirectiveBinding } from 'vue';
import { tooltip } from '@/directives/tooltip';

function binding(value: unknown): DirectiveBinding<any> {
  return { value } as DirectiveBinding<any>;
}

function createAnchor(): HTMLElement {
  const el = document.createElement('button');
  document.body.appendChild(el);
  return el;
}

describe('tooltip directive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('shows and hides an immediate tooltip via classes and attributes', () => {
    const el = createAnchor();
    tooltip.mounted?.(el, binding('Hello'));

    expect(el.classList.contains('dd-tooltip-anchor')).toBe(true);
    expect(el.getAttribute('data-dd-tooltip')).toBe('Hello');

    el.dispatchEvent(new Event('mouseenter'));
    expect(el.classList.contains('dd-tooltip-visible')).toBe(true);

    el.dispatchEvent(new Event('mouseleave'));
    expect(el.classList.contains('dd-tooltip-visible')).toBe(false);

    tooltip.beforeUnmount?.(el);
    expect(el.classList.contains('dd-tooltip-anchor')).toBe(false);
    expect(el.hasAttribute('data-dd-tooltip')).toBe(false);
  });

  it('supports delayed tooltips and clears pending timers on repeated show/hide', () => {
    const el = createAnchor();
    tooltip.mounted?.(el, binding({ value: 'Delayed', showDelay: 100 }));

    el.dispatchEvent(new Event('mouseenter'));
    el.dispatchEvent(new Event('mouseenter')); // clear prior timer path
    expect(el.classList.contains('dd-tooltip-visible')).toBe(false);

    vi.advanceTimersByTime(99);
    expect(el.classList.contains('dd-tooltip-visible')).toBe(false);

    el.dispatchEvent(new Event('mouseleave')); // clear pending timer in hide()
    vi.advanceTimersByTime(10);
    expect(el.classList.contains('dd-tooltip-visible')).toBe(false);

    el.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(100);
    expect(el.classList.contains('dd-tooltip-visible')).toBe(true);
  });

  it('updates existing bindings and binds from updated when state is missing', () => {
    const el = createAnchor();

    tooltip.updated?.(el, binding('First'));
    expect(el.getAttribute('data-dd-tooltip')).toBe('First');

    el.dispatchEvent(new Event('mouseenter'));
    expect(el.classList.contains('dd-tooltip-visible')).toBe(true);

    tooltip.updated?.(el, binding({ value: 'Second', showDelay: 50 }));
    el.dispatchEvent(new Event('mouseleave'));
    el.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(49);
    expect(el.classList.contains('dd-tooltip-visible')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(el.classList.contains('dd-tooltip-visible')).toBe(true);
    expect(el.getAttribute('data-dd-tooltip')).toBe('Second');

    tooltip.updated?.(el, binding(''));
    expect(el.classList.contains('dd-tooltip-visible')).toBe(false);
    expect(el.hasAttribute('data-dd-tooltip')).toBe(false);
  });

  it('handles empty/object bindings and unbind without prior bind', () => {
    const el = createAnchor();
    tooltip.mounted?.(el, binding(''));
    el.dispatchEvent(new Event('mouseenter'));
    expect(el.classList.contains('dd-tooltip-visible')).toBe(false);

    const objectBindingEl = createAnchor();
    tooltip.mounted?.(objectBindingEl, binding({}));
    objectBindingEl.dispatchEvent(new Event('focus'));
    expect(objectBindingEl.classList.contains('dd-tooltip-visible')).toBe(false);

    const fresh = createAnchor();
    expect(() => tooltip.beforeUnmount?.(fresh)).not.toThrow();
  });

  it('restores original title when unmounted', () => {
    const el = createAnchor();
    el.setAttribute('title', 'Native title');
    tooltip.mounted?.(el, binding('Custom title'));
    expect(el.getAttribute('title')).toBeNull();

    tooltip.beforeUnmount?.(el);
    expect(el.getAttribute('title')).toBe('Native title');
  });

  it('leaves title absent when none existed before mount', () => {
    const el = createAnchor();
    tooltip.mounted?.(el, binding('No native title'));

    tooltip.beforeUnmount?.(el);
    expect(el.hasAttribute('title')).toBe(false);
  });

  it('handles inconsistent title APIs where hasAttribute is true but getAttribute is null', () => {
    const el = createAnchor();
    const hasAttributeSpy = vi
      .spyOn(el, 'hasAttribute')
      .mockImplementation((name) =>
        name === 'title' ? true : HTMLElement.prototype.hasAttribute.call(el, name),
      );
    const getAttributeSpy = vi
      .spyOn(el, 'getAttribute')
      .mockImplementation((name) =>
        name === 'title' ? null : HTMLElement.prototype.getAttribute.call(el, name),
      );

    try {
      tooltip.mounted?.(el, binding('Edge case'));
      tooltip.beforeUnmount?.(el);
    } finally {
      hasAttributeSpy.mockRestore();
      getAttributeSpy.mockRestore();
    }

    expect(el.classList.contains('dd-tooltip-anchor')).toBe(false);
  });
});
