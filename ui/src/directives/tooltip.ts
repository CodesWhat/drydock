import type { DirectiveBinding, ObjectDirective } from 'vue';

interface TooltipBinding {
  value: string;
  showDelay?: number;
}

type BindingValue = string | TooltipBinding;

interface TooltipState {
  text: string;
  delay: number;
  timer: ReturnType<typeof setTimeout> | null;
  hadTitle: boolean;
  originalTitle: string | null;
  show: () => void;
  hide: () => void;
}

// ── Shared singleton tooltip element ──────────────────────────────
// Only one tooltip is ever visible at a time, so a single reusable
// DOM node avoids per-anchor allocation and keeps behaviour consistent.

const TOOLTIP_GAP = 8;
const VIEWPORT_PADDING = 8;

let sharedTip: HTMLElement | null = null;
let activeAnchor: HTMLElement | null = null;

function getSharedTip(): HTMLElement {
  if (!sharedTip) {
    sharedTip = document.createElement('div');
    sharedTip.className = 'dd-tooltip-popup';
    sharedTip.setAttribute('role', 'tooltip');
  }
  return sharedTip;
}

function positionTooltip(anchor: HTMLElement, tip: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();

  // Try top placement first
  let top = rect.top - tipRect.height - TOOLTIP_GAP;
  let placement: 'top' | 'bottom' = 'top';

  // Flip to bottom if overflowing top of viewport
  if (top < VIEWPORT_PADDING) {
    top = rect.bottom + TOOLTIP_GAP;
    placement = 'bottom';
  }

  // Center horizontally on anchor, clamp to viewport
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(
    VIEWPORT_PADDING,
    Math.min(left, window.innerWidth - tipRect.width - VIEWPORT_PADDING),
  );

  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
  tip.dataset.placement = placement;
}

function showTooltip(el: HTMLElement, state: TooltipState) {
  if (!state.text) return;

  // Dismiss any other active tooltip first
  if (activeAnchor && activeAnchor !== el) {
    hideTooltip();
  }

  const tip = getSharedTip();
  tip.textContent = state.text;

  if (!tip.parentNode) {
    document.body.appendChild(tip);
  }

  activeAnchor = el;

  // Position after the element is in the DOM so we can measure it
  positionTooltip(el, tip);

  // Force reflow before adding visible class for CSS transition
  tip.offsetHeight; // eslint-disable-line @typescript-eslint/no-unused-expressions
  tip.classList.add('dd-tooltip-visible');
}

function hideTooltip() {
  const tip = getSharedTip();
  tip.classList.remove('dd-tooltip-visible');
  tip.remove();
  activeAnchor = null;
}

// ── Directive state ───────────────────────────────────────────────

const stateMap = new WeakMap<HTMLElement, TooltipState>();

function parse(binding: DirectiveBinding<BindingValue>): { text: string; delay: number } {
  const value = binding.value;
  if (value == null || value === '') return { text: '', delay: 0 };
  if (typeof value === 'string') return { text: value, delay: 0 };
  return { text: value.value ?? '', delay: value.showDelay ?? 0 };
}

function makeShow(el: HTMLElement, state: TooltipState): () => void {
  return () => {
    if (!state.text) return;

    if (state.timer != null) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (state.delay > 0) {
      state.timer = setTimeout(() => {
        state.timer = null;
        showTooltip(el, state);
      }, state.delay);
      return;
    }

    showTooltip(el, state);
  };
}

function makeHide(_el: HTMLElement, state: TooltipState): () => void {
  return () => {
    if (state.timer != null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (activeAnchor === _el) {
      hideTooltip();
    }
  };
}

function bind(el: HTMLElement, binding: DirectiveBinding<BindingValue>) {
  const { text, delay } = parse(binding);
  const state: TooltipState = {
    text,
    delay,
    timer: null,
    hadTitle: el.hasAttribute('title'),
    originalTitle: el.getAttribute('title'),
    show: undefined as unknown as () => void,
    hide: undefined as unknown as () => void,
  };

  // Avoid native browser tooltip duplication while custom tooltip is active.
  if (state.hadTitle) {
    el.removeAttribute('title');
  }

  state.show = makeShow(el, state);
  state.hide = makeHide(el, state);

  el.addEventListener('mouseenter', state.show);
  el.addEventListener('mouseleave', state.hide);
  el.addEventListener('mousedown', state.hide);
  el.addEventListener('focus', state.show);
  el.addEventListener('blur', state.hide);
  stateMap.set(el, state);
}

function unbind(el: HTMLElement) {
  const state = stateMap.get(el);
  if (!state) return;

  state.hide();
  el.removeEventListener('mouseenter', state.show);
  el.removeEventListener('mouseleave', state.hide);
  el.removeEventListener('mousedown', state.hide);
  el.removeEventListener('focus', state.show);
  el.removeEventListener('blur', state.hide);

  if (state.hadTitle && state.originalTitle != null) {
    el.setAttribute('title', state.originalTitle);
  } else if (!state.hadTitle) {
    el.removeAttribute('title');
  }

  stateMap.delete(el);
}

export const tooltip: ObjectDirective<HTMLElement, BindingValue> = {
  mounted: bind,
  updated(el, binding) {
    const state = stateMap.get(el);
    if (!state) {
      bind(el, binding);
      return;
    }

    const { text, delay } = parse(binding);
    state.text = text;
    state.delay = delay;

    // Update live tooltip text if currently showing for this anchor
    if (activeAnchor === el && sharedTip) {
      sharedTip.textContent = text;
    }

    if (!text) {
      state.hide();
    }
  },
  beforeUnmount: unbind,
};
