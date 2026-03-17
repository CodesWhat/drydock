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

function getTooltipEl(): HTMLElement | null {
  return document.body.querySelector('.dd-tooltip-popup');
}

const mounted = tooltip.mounted as
  | ((el: HTMLElement, binding: DirectiveBinding<any>) => void)
  | undefined;
const updated = tooltip.updated as
  | ((el: HTMLElement, binding: DirectiveBinding<any>) => void)
  | undefined;
const beforeUnmount = tooltip.beforeUnmount as ((el: HTMLElement) => void) | undefined;

describe('tooltip directive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('shows tooltip in a body-appended popup on mouseenter and removes on mouseleave', () => {
    const el = createAnchor();
    mounted?.(el, binding('Hello'));

    el.dispatchEvent(new Event('mouseenter'));

    const tip = getTooltipEl();
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toBe('Hello');
    expect(tip!.classList.contains('dd-tooltip-visible')).toBe(true);
    expect(tip!.parentNode).toBe(document.body);
    expect(tip!.getAttribute('role')).toBe('tooltip');

    el.dispatchEvent(new Event('mouseleave'));
    expect(getTooltipEl()).toBeNull();

    beforeUnmount?.(el);
  });

  it('hides tooltip on mousedown', () => {
    const el = createAnchor();
    mounted?.(el, binding('Click'));

    el.dispatchEvent(new Event('mouseenter'));
    expect(getTooltipEl()).not.toBeNull();

    el.dispatchEvent(new Event('mousedown'));
    expect(getTooltipEl()).toBeNull();

    beforeUnmount?.(el);
  });

  it('shows on focus, hides on blur', () => {
    const el = createAnchor();
    mounted?.(el, binding('Focus'));

    el.dispatchEvent(new Event('focus'));
    expect(getTooltipEl()!.textContent).toBe('Focus');

    el.dispatchEvent(new Event('blur'));
    expect(getTooltipEl()).toBeNull();

    beforeUnmount?.(el);
  });

  it('supports delayed tooltips and clears pending timers on repeated show/hide', () => {
    const el = createAnchor();
    mounted?.(el, binding({ value: 'Delayed', showDelay: 100 }));

    el.dispatchEvent(new Event('mouseenter'));
    el.dispatchEvent(new Event('mouseenter')); // clear prior timer path
    expect(getTooltipEl()).toBeNull();

    vi.advanceTimersByTime(99);
    expect(getTooltipEl()).toBeNull();

    el.dispatchEvent(new Event('mouseleave')); // clear pending timer in hide()
    vi.advanceTimersByTime(10);
    expect(getTooltipEl()).toBeNull();

    el.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(100);
    expect(getTooltipEl()!.textContent).toBe('Delayed');

    beforeUnmount?.(el);
  });

  it('reuses a singleton popup element across anchors', () => {
    const a = createAnchor();
    const b = createAnchor();
    mounted?.(a, binding('A'));
    mounted?.(b, binding('B'));

    a.dispatchEvent(new Event('mouseenter'));
    const first = getTooltipEl();
    expect(first!.textContent).toBe('A');

    a.dispatchEvent(new Event('mouseleave'));
    b.dispatchEvent(new Event('mouseenter'));
    const second = getTooltipEl();
    expect(second!.textContent).toBe('B');

    // Same DOM element reused
    expect(first).toBe(second);

    beforeUnmount?.(a);
    beforeUnmount?.(b);
  });

  it('dismisses previous tooltip when a new anchor is hovered', () => {
    const a = createAnchor();
    const b = createAnchor();
    mounted?.(a, binding('A'));
    mounted?.(b, binding('B'));

    a.dispatchEvent(new Event('mouseenter'));
    expect(getTooltipEl()!.textContent).toBe('A');

    // Hover B without explicitly leaving A
    b.dispatchEvent(new Event('mouseenter'));
    expect(getTooltipEl()!.textContent).toBe('B');
    expect(document.body.querySelectorAll('.dd-tooltip-popup').length).toBe(1);

    beforeUnmount?.(a);
    beforeUnmount?.(b);
  });

  it('updates existing bindings and binds from updated when state is missing', () => {
    const el = createAnchor();

    updated?.(el, binding('First'));
    el.dispatchEvent(new Event('mouseenter'));
    expect(getTooltipEl()!.textContent).toBe('First');

    // Update text while visible
    updated?.(el, binding('Second'));
    expect(getTooltipEl()!.textContent).toBe('Second');

    // Update with delay
    el.dispatchEvent(new Event('mouseleave'));
    updated?.(el, binding({ value: 'Third', showDelay: 50 }));
    el.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(49);
    expect(getTooltipEl()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(getTooltipEl()!.textContent).toBe('Third');

    // Clear text hides tooltip
    updated?.(el, binding(''));
    expect(getTooltipEl()).toBeNull();

    beforeUnmount?.(el);
  });

  it('handles empty/object bindings and unbind without prior bind', () => {
    const el = createAnchor();
    mounted?.(el, binding(''));
    el.dispatchEvent(new Event('mouseenter'));
    expect(getTooltipEl()).toBeNull();

    const objectBindingEl = createAnchor();
    mounted?.(objectBindingEl, binding({}));
    objectBindingEl.dispatchEvent(new Event('focus'));
    expect(getTooltipEl()).toBeNull();

    const fresh = createAnchor();
    expect(() => beforeUnmount?.(fresh)).not.toThrow();

    beforeUnmount?.(el);
    beforeUnmount?.(objectBindingEl);
  });

  it('restores original title when unmounted', () => {
    const el = createAnchor();
    el.setAttribute('title', 'Native title');
    mounted?.(el, binding('Custom title'));
    expect(el.getAttribute('title')).toBeNull();

    beforeUnmount?.(el);
    expect(el.getAttribute('title')).toBe('Native title');
  });

  it('leaves title absent when none existed before mount', () => {
    const el = createAnchor();
    mounted?.(el, binding('No native title'));

    beforeUnmount?.(el);
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
      mounted?.(el, binding('Edge case'));
      beforeUnmount?.(el);
    } finally {
      hasAttributeSpy.mockRestore();
      getAttributeSpy.mockRestore();
    }

    // Should clean up without errors
    expect(getTooltipEl()).toBeNull();
  });

  it('sets data-placement attribute for positioning', () => {
    const el = createAnchor();
    mounted?.(el, binding('Positioned'));

    el.dispatchEvent(new Event('mouseenter'));
    const tip = getTooltipEl()!;
    expect(tip.dataset.placement).toBeDefined();
    expect(['top', 'bottom']).toContain(tip.dataset.placement);

    beforeUnmount?.(el);
  });

  it('removes tooltip from DOM on unmount even when visible', () => {
    const el = createAnchor();
    mounted?.(el, binding('Cleanup'));

    el.dispatchEvent(new Event('mouseenter'));
    expect(getTooltipEl()).not.toBeNull();

    beforeUnmount?.(el);
    expect(getTooltipEl()).toBeNull();
  });

  it('places tooltip on top when anchor is far enough from viewport top', () => {
    const el = createAnchor();
    mounted?.(el, binding('Top placement'));

    // Mock getBoundingClientRect so top placement has enough room
    const anchorMock = vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      bottom: 230,
      left: 100,
      right: 200,
      width: 100,
      height: 30,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });

    el.dispatchEvent(new Event('mouseenter'));
    const tip = getTooltipEl()!;
    expect(tip).not.toBeNull();

    // The tooltip tip element in JSDOM has 0-height getBoundingClientRect by default,
    // so top = 200 - 0 - 8 = 192, which is >= 8 (VIEWPORT_PADDING), so placement = 'top'
    expect(tip.dataset.placement).toBe('top');

    anchorMock.mockRestore();
    beforeUnmount?.(el);
  });

  it('does not re-append tooltip when it is already in the DOM', () => {
    const el = createAnchor();
    mounted?.(el, binding('Already in DOM'));

    el.dispatchEvent(new Event('mouseenter'));
    const tip = getTooltipEl()!;
    expect(tip).not.toBeNull();
    expect(tip.parentNode).toBe(document.body);

    // Hide tooltip (removes visible class and removes from DOM)
    el.dispatchEvent(new Event('mouseleave'));
    expect(getTooltipEl()).toBeNull();

    // Manually re-insert the tip into the DOM to simulate "already in DOM"
    document.body.appendChild(tip);
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    // Show again — tip.parentNode is truthy, so it should NOT call appendChild
    el.dispatchEvent(new Event('mouseenter'));
    // appendChild is called for other things potentially, but the tooltip should reuse
    // the existing node. The key check: tooltip is visible and still in DOM.
    expect(getTooltipEl()).not.toBeNull();
    expect(tip.classList.contains('dd-tooltip-visible')).toBe(true);

    // Verify appendChild was NOT called with the tip (it's already in DOM)
    const tipAppendCalls = appendSpy.mock.calls.filter((call) => call[0] === tip);
    expect(tipAppendCalls.length).toBe(0);

    appendSpy.mockRestore();
    beforeUnmount?.(el);
  });

  it('beforeUnmount safely handles anchors that were never shown', () => {
    const el = createAnchor();
    mounted?.(el, binding('Never shown'));

    expect(() => beforeUnmount?.(el)).not.toThrow();
  });

  it('showTooltip returns early when state.text is empty (delayed timer race)', async () => {
    // Exercise the defensive guard at showTooltip line 66.
    // Use a fresh module and capture the delayed timer callback. After emptying
    // state.text via updated, invoke the callback — showTooltip sees empty text
    // and returns early without creating a visible tooltip.
    vi.useRealTimers();
    vi.resetModules();
    const { tooltip: fresh } = await import('@/directives/tooltip');
    const mt = fresh.mounted as typeof mounted;
    const up = fresh.updated as typeof updated;
    const um = fresh.beforeUnmount as typeof beforeUnmount;

    const el = createAnchor();

    // Capture the timer callback by replacing setTimeout before mouseenter
    let captured: (() => void) | null = null;
    const origST = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => {
      captured = fn;
      return 12345;
    }) as any;

    mt?.(el, binding({ value: 'Race', showDelay: 50 }));
    el.dispatchEvent(new Event('mouseenter'));

    globalThis.setTimeout = origST;
    expect(captured).not.toBeNull();

    // Empty text via updated — modifies the SAME state object the closure captured
    up?.(el, binding(''));

    // Invoke the captured callback — showTooltip(el, state) where state.text = ''
    captured!();

    // The guard returned early — no tooltip should be visible
    expect(document.body.querySelector('.dd-tooltip-popup.dd-tooltip-visible')).toBeNull();

    um?.(el);
    vi.useFakeTimers();
  });
});
