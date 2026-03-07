import type { DirectiveBinding } from 'vue';
import { tooltip } from '@/directives/tooltip';

function binding(value: unknown): DirectiveBinding<any> {
  return { value } as DirectiveBinding<any>;
}

function createAnchor(rect: Partial<DOMRect> = {}): HTMLElement {
  const el = document.createElement('button');
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () =>
      ({
        left: 100,
        top: 100,
        width: 40,
        height: 20,
        bottom: 120,
        right: 140,
        x: 100,
        y: 100,
        toJSON: () => ({}),
        ...rect,
      }) as DOMRect,
  });
  document.body.appendChild(el);
  return el;
}

describe('tooltip directive', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows and hides an immediate tooltip', () => {
    const el = createAnchor();
    tooltip.mounted?.(el, binding('Hello'));

    el.dispatchEvent(new Event('mouseenter'));

    const tip = document.querySelector('[role="tooltip"]') as HTMLElement | null;
    expect(tip).not.toBeNull();
    expect(tip?.textContent).toBe('Hello');

    el.dispatchEvent(new Event('mouseleave'));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('clamps horizontal position when tooltip would overflow viewport', () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 100,
    });

    const el = createAnchor({ left: 90, width: 20, right: 110 });
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const created = originalCreateElement(tagName);
      if (tagName === 'div') {
        Object.defineProperty(created, 'getBoundingClientRect', {
          value: () =>
            ({
              left: 0,
              top: 0,
              width: 80,
              height: 20,
              bottom: 20,
              right: 80,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            }) as DOMRect,
        });
      }
      return created;
    });

    tooltip.mounted?.(el, binding('Clamp me'));
    el.dispatchEvent(new Event('mouseenter'));

    const tip = document.querySelector('[role="tooltip"]') as HTMLElement | null;
    expect(tip).not.toBeNull();
    expect(tip?.style.left).toBe('16px');

    createElementSpy.mockRestore();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it('runs requestAnimationFrame reveal callback to finalize tooltip fade-in', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return 1;
    });

    const el = createAnchor();
    tooltip.mounted?.(el, binding('RAF'));
    el.dispatchEvent(new Event('mouseenter'));

    const tip = document.querySelector('[role="tooltip"]') as HTMLElement | null;
    expect(tip).not.toBeNull();
    expect(tip?.style.opacity).toBe('0');
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks[0](16);
    expect(tip?.style.opacity).toBe('1');
  });

  it('supports delayed tooltips and cancels pending reveal on hide', () => {
    const el = createAnchor();
    tooltip.mounted?.(el, binding({ value: 'Delayed', showDelay: 100 }));

    el.dispatchEvent(new Event('mouseenter'));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    el.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(120);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('updates an existing tooltip binding and binds on updated when state is missing', () => {
    const el = createAnchor({ top: 0, left: 0, width: 20, height: 10, bottom: 10, right: 20 });
    tooltip.updated?.(el, binding('First'));

    el.dispatchEvent(new Event('mouseenter'));
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('First');

    tooltip.updated?.(el, binding({ value: 'Second', showDelay: 0 }));
    el.dispatchEvent(new Event('mouseleave'));
    el.dispatchEvent(new Event('mouseenter'));
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Second');

    tooltip.beforeUnmount?.(el);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('handles empty values and unbind without prior bind', () => {
    const el = createAnchor();
    tooltip.mounted?.(el, binding(''));
    el.dispatchEvent(new Event('mouseenter'));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    const fresh = createAnchor();
    expect(() => tooltip.beforeUnmount?.(fresh)).not.toThrow();
  });

  it('handles object bindings with missing value and delay defaults', () => {
    const el = createAnchor();
    tooltip.mounted?.(el, binding({}));
    el.dispatchEvent(new Event('mouseenter'));

    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
