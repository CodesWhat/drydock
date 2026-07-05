import { flushPromises, mount } from '@vue/test-utils';
import CopyableTag from '@/components/CopyableTag.vue';

function mountTag(props: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) {
  const tooltipValues: unknown[] = [];
  const wrapper = mount(CopyableTag, {
    props: { tag: 'v1.2.3', ...props },
    attrs,
    global: {
      directives: {
        tooltip: {
          mounted(_el, binding) {
            tooltipValues.push(binding.value);
          },
          updated(_el, binding) {
            tooltipValues.push(binding.value);
          },
        },
      },
    },
  });
  return { wrapper, tooltipValues };
}

describe('CopyableTag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (document as any).execCommand;
  });

  it('mounts the real component template rather than the global test stub', () => {
    // tests/setup.ts globally registers a bare `<span><slot /></span>` stub for
    // CopyableTag (by name) so unrelated specs don't have to deal with clipboard
    // machinery. Mounting the SFC directly bypasses that name-based stub — if it
    // didn't, this trivially-true assertion about the real template's class
    // would fail, since the stub renders no class at all.
    const { wrapper } = mountTag();
    expect(wrapper.classes()).toContain('cursor-pointer');
  });

  it('renders the tag via the default slot', () => {
    const { wrapper } = mountTag({ tag: 'latest' });
    expect(wrapper.text()).toBe('latest');
  });

  it('copies via the clipboard API when available (success path)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { wrapper, tooltipValues } = mountTag({ tag: 'success-tag' });
    await wrapper.trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith('success-tag');
    expect(tooltipValues.at(-1)).toBe('Copied!');
  });

  it('falls back to execCommand when the clipboard API is unavailable (fallback path)', async () => {
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = vi.fn().mockReturnValue(true);

    const { wrapper, tooltipValues } = mountTag({ tag: 'fallback-tag' });
    await wrapper.trigger('click');
    await flushPromises();

    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(tooltipValues.at(-1)).toBe('Copied!');
  });

  it('applies the danger color to the failed element even when the parent passes a conflicting static style attr', async () => {
    // Regression test for the fallthrough-attrs bug: real call sites pass a
    // static `style="color: var(--dd-success);"` attribute on <CopyableTag>.
    // Vue 3 merges fallthrough attrs onto the component's root AFTER the
    // root's own bindings, so the parent's style wins on conflicting keys. If
    // the failed-state color were bound on the root itself, it would be
    // silently overridden by the parent's success-green and never render.
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = vi.fn().mockReturnValue(false);

    const { wrapper, tooltipValues } = mountTag(
      { tag: 'failed-tag' },
      { style: 'color: var(--dd-success);' },
    );
    await wrapper.trigger('click');
    await flushPromises();

    expect(tooltipValues.at(-1)).toBe('Copy failed');

    const innerSpan = wrapper.find('span > span');
    expect(innerSpan.exists()).toBe(true);
    expect(innerSpan.attributes('style')).toContain('color: var(--dd-danger)');
  });
});
