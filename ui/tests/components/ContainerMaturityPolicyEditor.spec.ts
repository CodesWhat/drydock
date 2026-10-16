import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import ContainerMaturityPolicyEditor from '@/components/containers/ContainerMaturityPolicyEditor.vue';

const { getContext } = vi.hoisted(() => ({ getContext: vi.fn() }));
vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: getContext,
}));

function mountActions() {
  const context = {
    selectedHasMaturityPolicy: ref(true),
    selectedMaturityMode: ref('mature'),
    selectedMaturitySkipReleases: ref(0),
    selectedMaturityReleaseFallbackDays: ref(0),
    maturityModeInput: ref('mature'),
    maturityMinAgeDaysInput: ref(5),
    maturitySkipReleasesInput: ref(0),
    maturityReleaseFallbackDaysInput: ref(0),
    policyInProgress: ref<string | null>(null),
    setMaturityPolicySelected: vi.fn(),
    selectedPolicyGroupName: ref<string | undefined>(),
    selectedPolicyGroupFields: ref(new Set<string>()),
    selectedPolicyOverrideFields: ref(new Set<string>()),
    selectedPolicyOverriddenFields: ref(new Set<string>()),
    revertPolicySelected: vi.fn(),
  };
  getContext.mockReturnValue(context);
  return { context, wrapper: mount(ContainerMaturityPolicyEditor) };
}

test('release maturity inputs bind independently and apply together with the day gate', async () => {
  const { context, wrapper } = mountActions();
  const count = wrapper.get('[data-testid="maturity-skip-releases"]');
  const fallback = wrapper.get('[data-testid="maturity-release-fallback"]');
  expect(count.attributes('min')).toBe('0');
  expect(count.attributes('max')).toBe('100');
  expect(fallback.attributes('max')).toBe('365');
  await count.setValue('2');
  await fallback.setValue('10');
  await wrapper.get('[data-testid="apply-maturity-policy"]').trigger('click');
  expect(context.maturitySkipReleasesInput.value).toBe(2);
  expect(context.maturityReleaseFallbackDaysInput.value).toBe(10);
  expect(context.maturityMinAgeDaysInput.value).toBe(5);
  expect(context.setMaturityPolicySelected).toHaveBeenCalledWith('mature');
  context.policyInProgress.value = 'c1';
  await wrapper.vm.$nextTick();
  expect(count.attributes('disabled')).toBeDefined();
  expect(fallback.attributes('disabled')).toBeDefined();
  wrapper.unmount();
});

test('release fields show their source and support reverting an individual override', async () => {
  const { context, wrapper } = mountActions();
  context.selectedPolicyGroupName.value = 'payments';
  context.selectedPolicyGroupFields.value.add('maturitySkipReleases');
  context.selectedPolicyOverrideFields.value.add('maturityReleaseFallbackDays');
  context.selectedPolicyOverriddenFields.value.add('maturityReleaseFallbackDays');
  await wrapper.vm.$nextTick();
  expect(wrapper.get('[data-test="policy-group-maturitySkipReleases"]').text()).toContain(
    'payments',
  );
  await wrapper.get('[data-test="policy-revert-maturityReleaseFallbackDays"]').trigger('click');
  expect(context.revertPolicySelected).toHaveBeenCalledWith('maturityReleaseFallbackDays');
  wrapper.unmount();
});
