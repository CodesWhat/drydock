import type { Directive, DirectiveBinding } from 'vue';

interface TooltipBinding {
  value: string;
  showDelay?: number;
}

type BindingValue = string | TooltipBinding;

interface TooltipState {
  el: HTMLElement;
  tip: HTMLElement | null;
  timer: ReturnType<typeof setTimeout> | null;
  text: string;
  delay: number;
  show: () => void;
  hide: () => void;
}

const stateMap = new WeakMap<HTMLElement, TooltipState>();

function parse(binding: DirectiveBinding<BindingValue>): { text: string; delay: number } {
  const v = binding.value;
  if (v == null || v === '') return { text: '', delay: 0 };
  if (typeof v === 'string') return { text: v, delay: 0 };
  return { text: v.value ?? '', delay: v.showDelay ?? 0 };
}

function createTip(state: TooltipState) {
  const tip = document.createElement('div');
  tip.setAttribute('role', 'tooltip');
  tip.textContent = state.text;
  Object.assign(tip.style, {
    position: 'fixed',
    zIndex: '9999',
    pointerEvents: 'none',
    fontFamily: 'var(--drydock-font, "IBM Plex Mono", monospace)',
    fontSize: '11px',
    padding: '4px 8px',
    background: 'var(--dd-bg-card)',
    color: 'var(--dd-text)',
    border: '1px solid var(--dd-border-strong)',
    borderRadius: 'var(--dd-radius-sm)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    whiteSpace: 'nowrap',
    opacity: '0',
    transition: 'opacity 0.15s ease',
  });
  return tip;
}

function position(tip: HTMLElement, el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let left = rect.left + (rect.width - tipRect.width) / 2;

  // Prefer above, flip below if not enough room
  let top = rect.top - tipRect.height - 6;
  if (top < 4) {
    top = rect.bottom + 6;
  }

  // Clamp horizontal position to viewport
  if (left < 4) left = 4;
  if (left + tipRect.width > window.innerWidth - 4) {
    left = window.innerWidth - tipRect.width - 4;
  }

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function makeShow(state: TooltipState): () => void {
  return () => {
    if (!state.text) return;
    const tip = createTip(state);
    state.tip = tip;

    const reveal = () => {
      document.body.appendChild(tip);
      // Force layout then position and fade in
      position(tip, state.el);
      requestAnimationFrame(() => {
        tip.style.opacity = '1';
        position(tip, state.el);
      });
    };

    if (state.delay > 0) {
      state.timer = setTimeout(reveal, state.delay);
    } else {
      reveal();
    }
  };
}

function makeHide(state: TooltipState): () => void {
  return () => {
    if (state.timer != null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.tip?.parentNode) {
      state.tip.remove();
    }
    state.tip = null;
  };
}

function bind(el: HTMLElement, binding: DirectiveBinding<BindingValue>) {
  const { text, delay } = parse(binding);
  const state: TooltipState = {
    el,
    tip: null,
    timer: null,
    text,
    delay,
    show: () => {},
    hide: () => {},
  };
  state.show = makeShow(state);
  state.hide = makeHide(state);

  el.addEventListener('mouseenter', state.show);
  el.addEventListener('mouseleave', state.hide);
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
  el.removeEventListener('focus', state.show);
  el.removeEventListener('blur', state.hide);
  stateMap.delete(el);
}

export const tooltip: Directive<HTMLElement, BindingValue> = {
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
  },
  beforeUnmount: unbind,
};
