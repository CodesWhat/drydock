import type { Directive, DirectiveBinding } from 'vue';

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

const stateMap = new WeakMap<HTMLElement, TooltipState>();

function parse(binding: DirectiveBinding<BindingValue>): { text: string; delay: number } {
  const value = binding.value;
  if (value == null || value === '') return { text: '', delay: 0 };
  if (typeof value === 'string') return { text: value, delay: 0 };
  return { text: value.value ?? '', delay: value.showDelay ?? 0 };
}

function applyTooltipText(el: HTMLElement, text: string) {
  if (text) {
    el.setAttribute('data-dd-tooltip', text);
  } else {
    el.removeAttribute('data-dd-tooltip');
  }
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
        el.classList.add('dd-tooltip-visible');
      }, state.delay);
      return;
    }

    el.classList.add('dd-tooltip-visible');
  };
}

function makeHide(el: HTMLElement, state: TooltipState): () => void {
  return () => {
    if (state.timer != null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    el.classList.remove('dd-tooltip-visible');
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

  el.classList.add('dd-tooltip-anchor');
  applyTooltipText(el, text);
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

  el.classList.remove('dd-tooltip-anchor');
  el.classList.remove('dd-tooltip-visible');
  el.removeAttribute('data-dd-tooltip');

  if (state.hadTitle && state.originalTitle != null) {
    el.setAttribute('title', state.originalTitle);
  } else if (!state.hadTitle) {
    el.removeAttribute('title');
  }

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
    applyTooltipText(el, text);

    if (!text) {
      state.hide();
    }
  },
  beforeUnmount: unbind,
};
