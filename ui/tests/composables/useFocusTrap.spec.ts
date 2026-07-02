import { computed, effectScope, nextTick, ref } from 'vue';
import { useFocusTrap } from '@/composables/useFocusTrap';

function createContainer(innerHtml = ''): HTMLElement {
  const container = document.createElement('div');
  container.tabIndex = -1;
  container.innerHTML = innerHtml;
  document.body.appendChild(container);
  return container;
}

describe('useFocusTrap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves focus to the container when activated', async () => {
    const container = createContainer('<button>One</button>');
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(false);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));

    active.value = true;
    await nextTick();

    expect(document.activeElement).toBe(container);
    scope.stop();
  });

  it('focuses the container immediately when active starts true', async () => {
    const container = createContainer('<button>One</button>');
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(true);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));

    await nextTick();

    expect(document.activeElement).toBe(container);
    scope.stop();
  });

  it('saves the previously focused element and restores it on deactivation', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const container = createContainer('<button>One</button>');
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(false);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));

    active.value = true;
    await nextTick();
    expect(document.activeElement).toBe(container);

    active.value = false;
    await nextTick();
    expect(document.activeElement).toBe(trigger);

    scope.stop();
  });

  it('skips restore when the previously focused element is no longer connected', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const container = createContainer('<button>One</button>');
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(false);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));

    active.value = true;
    await nextTick();

    trigger.remove();
    expect(trigger.isConnected).toBe(false);

    active.value = false;
    await nextTick();

    expect(document.activeElement).not.toBe(trigger);

    scope.stop();
  });

  it('treats a non-HTMLElement activeElement as nothing to restore', async () => {
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.appendChild(svgEl);
    expect(svgEl instanceof HTMLElement).toBe(false);

    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => svgEl,
    });

    const container = createContainer('<button>One</button>');
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(false);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));

    active.value = true;
    await nextTick();

    Reflect.deleteProperty(document, 'activeElement');
    expect(document.activeElement).toBe(container);

    active.value = false;
    await nextTick();

    // Nothing was tracked as "previously focused" (svg isn't an HTMLElement),
    // so deactivation has nothing to restore and focus simply stays put.
    expect(document.activeElement).toBe(container);

    scope.stop();
  });

  it('wraps Tab from the last focusable element to the first', async () => {
    const container = createContainer(
      '<button id="first">First</button><button id="second">Second</button>',
    );
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(true);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));
    await nextTick();

    const second = container.querySelector('#second') as HTMLElement;
    second.focus();

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(document.activeElement?.id).toBe('first');
    expect(event.defaultPrevented).toBe(true);

    scope.stop();
  });

  it('wraps Shift+Tab from the first focusable element to the last', async () => {
    const container = createContainer(
      '<button id="first">First</button><button id="second">Second</button>',
    );
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(true);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));
    await nextTick();

    const first = container.querySelector('#first') as HTMLElement;
    first.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(document.activeElement?.id).toBe('second');
    expect(event.defaultPrevented).toBe(true);

    scope.stop();
  });

  it('does not wrap Tab when focus is on a middle element', async () => {
    const container = createContainer(
      '<button id="first">First</button><button id="second">Second</button><button id="third">Third</button>',
    );
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(true);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));
    await nextTick();

    const second = container.querySelector('#second') as HTMLElement;
    second.focus();

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    // Trap doesn't intervene for a middle element — no wrap, no preventDefault.
    expect(document.activeElement?.id).toBe('second');
    expect(event.defaultPrevented).toBe(false);

    scope.stop();
  });

  it('keeps focus on the container and prevents default when there are no focusable descendants', async () => {
    const container = createContainer('');
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(true);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));
    await nextTick();

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(document.activeElement).toBe(container);
    expect(event.defaultPrevented).toBe(true);

    scope.stop();
  });

  it('does not throw and no-ops focus calls when the container ref is null', async () => {
    const containerRef = ref<HTMLElement | null>(null);
    const active = ref(false);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));

    active.value = true;
    await nextTick();

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    expect(() => document.dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(true);

    scope.stop();
  });

  it('ignores keydown events that are not Tab', async () => {
    const container = createContainer(
      '<button id="first">First</button><button id="second">Second</button>',
    );
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(true);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));
    await nextTick();

    const second = container.querySelector('#second') as HTMLElement;
    second.focus();

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(document.activeElement).toBe(second);
    expect(event.defaultPrevented).toBe(false);

    scope.stop();
  });

  it('does not intervene on Tab while inactive', async () => {
    const container = createContainer('<button id="first">First</button>');
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(false);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));
    await nextTick();

    const first = container.querySelector('#first') as HTMLElement;
    first.focus();

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);

    scope.stop();
  });

  it('removes the keydown listener and restores focus when the scope is disposed while active', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const container = createContainer('<button>One</button>');
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(false);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));

    active.value = true;
    await nextTick();
    expect(document.activeElement).toBe(container);

    scope.stop();

    expect(document.activeElement).toBe(trigger);

    trigger.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing on scope disposal when the trap was never activated', () => {
    const container = createContainer('<button>One</button>');
    const containerRef = ref<HTMLElement | null>(container);
    const active = ref(false);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));

    expect(() => scope.stop()).not.toThrow();
  });

  it('accepts a ComputedRef for the active source', async () => {
    const container = createContainer('<button>One</button>');
    const containerRef = ref<HTMLElement | null>(container);
    const open = ref(false);
    const active = computed(() => open.value);
    const scope = effectScope();
    scope.run(() => useFocusTrap(containerRef, active));

    open.value = true;
    await nextTick();

    expect(document.activeElement).toBe(container);
    scope.stop();
  });
});
