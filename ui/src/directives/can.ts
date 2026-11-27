import type { Directive, DirectiveBinding } from 'vue';
import { can } from '../composables/useCan';

/**
 * `v-can="'containers:update'"` hides the element when the current user lacks
 * the scope; `v-can.disable` disables it instead. UX only, the server enforces.
 */
const HIDDEN_FLAG = 'ddCanHiddenDisplay';
const DISABLED_FLAG = 'ddCanDisabled';

function apply(el: HTMLElement, binding: DirectiveBinding<string>): void {
  const allowed = can(binding.value);
  if (binding.modifiers.disable) {
    if (!allowed) {
      el.setAttribute('disabled', '');
      el.setAttribute('aria-disabled', 'true');
      el.dataset[DISABLED_FLAG] = '1';
    } else if (el.dataset[DISABLED_FLAG]) {
      el.removeAttribute('disabled');
      el.removeAttribute('aria-disabled');
      delete el.dataset[DISABLED_FLAG];
    }
    return;
  }
  if (!allowed) {
    if (el.dataset[HIDDEN_FLAG] === undefined) {
      el.dataset[HIDDEN_FLAG] = el.style.display;
    }
    el.style.display = 'none';
  } else if (el.dataset[HIDDEN_FLAG] !== undefined) {
    el.style.display = el.dataset[HIDDEN_FLAG];
    delete el.dataset[HIDDEN_FLAG];
  }
}

export const canDirective: Directive<HTMLElement, string> = {
  mounted: apply,
  updated: apply,
};
