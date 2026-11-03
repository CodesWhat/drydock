import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import ContainerFullPageLabelsTab from '@/components/containers/ContainerFullPageLabelsTab.vue';

const selectedContainer = ref({ details: { labels: [] as string[] } });

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => ({ selectedContainer }),
}));

function mountComponent() {
  return mount(ContainerFullPageLabelsTab, {
    global: {
      stubs: { AppIcon: { template: '<span class="app-icon-stub" />', props: ['name', 'size'] } },
    },
  });
}

describe('ContainerFullPageLabelsTab', () => {
  afterEach(() => {
    selectedContainer.value = { details: { labels: [] } };
  });

  it('shows the empty state and a zero count when the container has no labels', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Labels');
    expect(wrapper.text()).toContain('No labels assigned');
    expect(wrapper.find('.badge.ml-auto').text()).toBe('0');
  });

  it('lists every label as a badge and shows the label count', () => {
    selectedContainer.value = {
      details: { labels: ['dd.watch=true', 'com.example.team=infra'] },
    };

    const wrapper = mountComponent();

    expect(wrapper.text()).not.toContain('No labels assigned');
    expect(wrapper.find('.badge.ml-auto').text()).toBe('2');
    const labelBadges = wrapper.findAll('.flex-wrap .badge');
    expect(labelBadges.map((badge) => badge.text())).toEqual([
      'dd.watch=true',
      'com.example.team=infra',
    ]);
  });
});
