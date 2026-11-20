import { mount } from '@vue/test-utils';
import UpdateCandidatesList from '@/components/containers/UpdateCandidatesList.vue';

const globalConfig = {
  stubs: {
    CopyableTag: { template: '<span class="copyable-tag"><slot /></span>', props: ['tag'] },
  },
  directives: { tooltip: () => {} },
};

describe('UpdateCandidatesList', () => {
  it('lists each update type with its tag', () => {
    const wrapper = mount(UpdateCandidatesList, {
      props: {
        candidates: [
          { kind: 'patch', tag: '1.2.9' },
          { kind: 'minor', tag: '1.5.0' },
          { kind: 'major', tag: '3.0.0' },
        ],
      },
      global: globalConfig,
    });

    expect(wrapper.get('[data-test="update-candidates"]').text()).toContain(
      'Candidates by update type',
    );
    expect(wrapper.get('[data-test="update-candidate-patch"]').text()).toContain('Patch');
    expect(wrapper.get('[data-test="update-candidate-patch"]').text()).toContain('1.2.9');
    expect(wrapper.get('[data-test="update-candidate-minor"]').text()).toContain('1.5.0');
    expect(wrapper.get('[data-test="update-candidate-major"]').text()).toContain('3.0.0');
  });

  it('renders nothing for a single candidate, which is the main update', () => {
    const wrapper = mount(UpdateCandidatesList, {
      props: { candidates: [{ kind: 'minor', tag: '1.5.0' }] },
      global: globalConfig,
    });

    expect(wrapper.find('[data-test="update-candidates"]').exists()).toBe(false);
  });

  it('renders nothing without candidates', () => {
    const wrapper = mount(UpdateCandidatesList, {
      props: { candidates: undefined },
      global: globalConfig,
    });

    expect(wrapper.find('[data-test="update-candidates"]').exists()).toBe(false);
  });
});
