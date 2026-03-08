import { mount } from '@vue/test-utils';
import { defineComponent, h, provide } from 'vue';
import {
  containersViewTemplateContextKey,
  useContainersViewTemplateContext,
} from '@/components/containers/containersViewTemplateContext';

describe('containersViewTemplateContext', () => {
  it('throws when no provider is available', () => {
    expect(() => useContainersViewTemplateContext()).toThrow(
      'ContainersView template context is not available',
    );
  });

  it('returns the provided context instance', () => {
    const provided = { test: true } as any;
    const captured: { value?: unknown } = {};

    const Child = defineComponent({
      setup() {
        captured.value = useContainersViewTemplateContext();
        return () => h('div');
      },
    });

    const Parent = defineComponent({
      setup() {
        provide(containersViewTemplateContextKey, provided);
        return () => h(Child);
      },
    });

    mount(Parent);
    expect(captured.value).toBe(provided);
  });
});
