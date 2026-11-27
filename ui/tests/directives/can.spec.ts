import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { setCurrentAuthority } from '@/composables/useCan';
import { canDirective } from '@/directives/can';

function mountWith(template: string) {
  const bump = ref(0);
  const Comp = defineComponent({
    directives: { can: canDirective },
    setup: () => ({ bump }),
    template: `<div :data-b="bump">${template}</div>`,
  });
  return { wrapper: mount(Comp), bump };
}

describe('v-can', () => {
  afterEach(() => setCurrentAuthority(undefined));

  it('hides the element without the scope and keeps it with it', () => {
    setCurrentAuthority({ role: 'viewer', scopes: ['read'] });
    const { wrapper } = mountWith(
      `<button id="u" v-can="'containers:update'">u</button><button id="r" v-can="'read'">r</button>`,
    );
    expect((wrapper.get('#u').element as HTMLElement).style.display).toBe('none');
    expect((wrapper.get('#r').element as HTMLElement).style.display).toBe('');
  });

  it('shows the element again when the role gains the scope', async () => {
    setCurrentAuthority({ role: 'viewer', scopes: ['read'] });
    const { wrapper, bump } = mountWith(`<button id="u" v-can="'containers:update'">u</button>`);
    setCurrentAuthority({ role: 'operator', scopes: ['read', 'containers:update'] });
    bump.value++;
    await nextTick();
    expect((wrapper.get('#u').element as HTMLElement).style.display).toBe('');
  });

  it('restores an inline display it replaced', async () => {
    setCurrentAuthority({ role: 'viewer', scopes: ['read'] });
    const { wrapper, bump } = mountWith(
      `<button id="u" style="display: inline-flex" v-can="'admin'">u</button>`,
    );
    expect((wrapper.get('#u').element as HTMLElement).style.display).toBe('none');
    setCurrentAuthority(undefined);
    bump.value++;
    await nextTick();
    expect((wrapper.get('#u').element as HTMLElement).style.display).toBe('inline-flex');
  });

  it('disables instead of hiding with the disable modifier, and re-enables', async () => {
    setCurrentAuthority({ role: 'viewer', scopes: ['read'] });
    const { wrapper, bump } = mountWith(`<button id="u" v-can.disable="'admin'">u</button>`);
    const el = wrapper.get('#u').element as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.style.display).toBe('');
    setCurrentAuthority({ role: 'admin', scopes: ['admin'] });
    bump.value++;
    await nextTick();
    expect(el.disabled).toBe(false);
    expect(el.hasAttribute('aria-disabled')).toBe(false);
    bump.value++;
    await nextTick();
    expect(el.disabled).toBe(false);
  });
});
