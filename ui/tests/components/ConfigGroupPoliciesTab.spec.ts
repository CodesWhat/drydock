import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import ConfigGroupPoliciesTab from '@/components/config/ConfigGroupPoliciesTab.vue';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { getContainerGroups } from '@/services/container';
import {
  createGroupPolicy,
  deleteGroupPolicy,
  type GroupPolicy,
  GroupPolicyHttpError,
  listGroupPolicies,
  replaceGroupPolicy,
} from '@/services/group-policy';
import { getAllTriggers } from '@/services/trigger';

vi.mock('@/services/group-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/group-policy')>()),
  listGroupPolicies: vi.fn(),
  createGroupPolicy: vi.fn(),
  replaceGroupPolicy: vi.fn(),
  deleteGroupPolicy: vi.fn(),
}));
vi.mock('@/services/container', () => ({ getContainerGroups: vi.fn() }));
vi.mock('@/services/trigger', () => ({ getAllTriggers: vi.fn() }));

const loadUpdateMode = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useUpdateMode', async () => {
  const { ref } = await import('vue');
  return { useUpdateMode: () => ({ updateMode: ref('auto'), loadUpdateMode }) };
});

const route = reactive({ query: {} as Record<string, string | string[]> });
const replace = vi.fn((to: { query: Record<string, string> }) => {
  for (const key of Object.keys(route.query)) delete route.query[key];
  Object.assign(route.query, to.query);
});
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }));

function policy(overrides: Partial<GroupPolicy> = {}): GroupPolicy {
  return {
    id: 'p1',
    group: 'payments',
    revision: 2,
    updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7, skipTags: ['1.0'] },
    actions: { updateMode: 'manual', exclude: ['docker.local'] },
    createdAt: '',
    createdBy: 'user:scott',
    updatedAt: '',
    updatedBy: 'user:scott',
    members: { count: 2, agents: [null, 'edge1'] },
    ...overrides,
  };
}
const group = (name: string | null, containerCount: number) => ({
  name,
  containers: [],
  containerCount,
  updatesAvailable: 0,
});
const write = (members = 2, warnings: string[] = []) => ({
  policy: policy(),
  applied: { members },
  warnings,
  changed: true,
});

const tid = (id: string) => `[data-testid="group-policy-${id}"]`;
const tab = (id: string) => `[data-testid="group-policies-${id}"]`;

async function mountTab() {
  const wrapper = mount(ConfigGroupPoliciesTab);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.mocked(listGroupPolicies).mockReset().mockResolvedValue([policy()]);
  vi.mocked(getContainerGroups)
    .mockReset()
    .mockResolvedValue([group('payments', 2), group('web', 1), group(null, 5)]);
  vi.mocked(getAllTriggers)
    .mockReset()
    .mockResolvedValue([{ id: 'docker.local', type: 'docker', name: 'local' }] as never);
  vi.mocked(createGroupPolicy)
    .mockReset()
    .mockResolvedValue(write() as never);
  vi.mocked(replaceGroupPolicy)
    .mockReset()
    .mockResolvedValue(write() as never);
  vi.mocked(deleteGroupPolicy)
    .mockReset()
    .mockResolvedValue(write() as never);
  loadUpdateMode.mockReset().mockResolvedValue(undefined);
  replace.mockClear();
  for (const key of Object.keys(route.query)) delete route.query[key];
  useConfirmDialog().dismiss();
});

describe('ConfigGroupPoliciesTab list', () => {
  it('loads the global mode and lists groups with and without a policy', async () => {
    const wrapper = await mountTab();
    expect(loadUpdateMode).toHaveBeenCalled();
    const rows = wrapper.findAll(tab('row'));
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('payments');
    expect(rows[0].text()).toContain('2 containers');
    expect(rows[0].text()).toContain('Hosts: Controller, edge1');
    expect(rows[0].text()).toContain('Maturity: Mature only');
    expect(rows[0].text()).toContain('Min age: 7 d');
    expect(rows[0].text()).toContain('Skipped tags: 1');
    expect(rows[0].text()).toContain('Updates: Manual only');
    expect(rows[0].text()).toContain('Excluded triggers: 1');
    expect(rows[1].text()).toContain('web');
    expect(rows[1].text()).toContain('1 containers');
    expect(rows[1].text()).toContain('No policy');
    expect(rows[1].text()).not.toContain('Hosts:');
    expect(wrapper.text()).toContain('Stored in Drydock, not in Docker labels.');
  });

  it('summarises every field kind', async () => {
    vi.mocked(listGroupPolicies).mockResolvedValue([
      policy({
        updatePolicy: { skipDigests: ['sha256:a', 'sha256:b'] },
        actions: { updateMode: 'notify' },
      }),
    ]);
    const wrapper = await mountTab();
    const text = wrapper.find(tab('row')).text();
    expect(text).toContain('Skipped digests: 2');
    expect(text).toContain('Updates: Notify only');
    expect(text).not.toContain('Maturity');
  });

  it('flags a policy whose group has no current members', async () => {
    vi.mocked(listGroupPolicies).mockResolvedValue([
      policy({ group: 'ghost', members: { count: 0, agents: [] } }),
    ]);
    vi.mocked(getContainerGroups).mockResolvedValue([]);
    const wrapper = await mountTab();
    expect(wrapper.find(tab('row')).text()).toContain(
      'No current members; applies to future members',
    );
  });

  it('renders names exactly, with edge whitespace visible', async () => {
    vi.mocked(listGroupPolicies).mockResolvedValue([]);
    vi.mocked(getContainerGroups).mockResolvedValue([group(' pay ', 1)]);
    const wrapper = await mountTab();
    expect(wrapper.find(tab('row')).text()).toContain('␣pay␣');
  });

  it('shows the empty state', async () => {
    vi.mocked(listGroupPolicies).mockResolvedValue([]);
    vi.mocked(getContainerGroups).mockResolvedValue([]);
    const wrapper = await mountTab();
    expect(wrapper.find(tab('empty')).exists()).toBe(true);
    expect(wrapper.findAll(tab('row'))).toHaveLength(0);
  });

  it('shows a loading state while the first load runs', async () => {
    vi.mocked(listGroupPolicies).mockReturnValue(new Promise(() => {}));
    const wrapper = mount(ConfigGroupPoliciesTab);
    await flushPromises();
    expect(wrapper.find(tab('loading')).exists()).toBe(true);
    expect(wrapper.find(tab('empty')).exists()).toBe(false);
  });

  it('shows a load error and retries', async () => {
    vi.mocked(listGroupPolicies).mockRejectedValueOnce(new Error('offline'));
    const wrapper = await mountTab();
    expect(wrapper.find(tab('error')).text()).toContain('offline');
    expect(wrapper.find(tab('empty')).exists()).toBe(false);
    await wrapper.find(tab('retry')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tab('error')).exists()).toBe(false);
    expect(wrapper.findAll(tab('row'))).toHaveLength(2);
  });
});

describe('ConfigGroupPoliciesTab editing', () => {
  it('opens the editor for a policy row and updates the link', async () => {
    const wrapper = await mountTab();
    await wrapper.findAll(tab('edit'))[0].trigger('click');
    expect(wrapper.find(tid('save')).exists()).toBe(true);
    expect(wrapper.text()).toContain('Group policy: payments');
    expect(replace).toHaveBeenCalledWith({ query: { tab: 'groupPolicies', group: 'payments' } });
  });

  it('opens create for a group without a policy, keeping the name fixed', async () => {
    const wrapper = await mountTab();
    await wrapper.findAll(tab('edit'))[1].trigger('click');
    expect(wrapper.find(tid('name')).exists()).toBe(false);
    expect(wrapper.find(tid('remove')).exists()).toBe(false);
    await wrapper.find(tid('maturity-mode')).setValue('all');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(createGroupPolicy).toHaveBeenCalledWith('web', {
      updatePolicy: { maturityMode: 'all' },
      actions: {},
    });
  });

  it('opens the editor from a deep link, decoded', async () => {
    route.query.tab = 'groupPolicies';
    route.query.group = 'payments';
    const wrapper = await mountTab();
    expect(wrapper.text()).toContain('Group policy: payments');
  });

  it('takes the first value of a repeated link parameter', async () => {
    route.query.group = ['web', 'payments'];
    const wrapper = await mountTab();
    expect(wrapper.text()).toContain('Group policy: web');
  });

  it('opens create with the name prefilled for an unknown linked group', async () => {
    route.query.group = 'brand-new';
    const wrapper = await mountTab();
    expect((wrapper.find(tid('name')).element as HTMLInputElement).value).toBe('brand-new');
  });

  it('follows the link when it changes later', async () => {
    const wrapper = await mountTab();
    expect(wrapper.find(tid('save')).exists()).toBe(false);
    route.query.group = 'payments';
    await flushPromises();
    expect(wrapper.text()).toContain('Group policy: payments');
    delete route.query.group;
    await flushPromises();
    expect(wrapper.find(tid('save')).exists()).toBe(false);
  });

  it('starts a new policy with an editable name', async () => {
    route.query.group = 'payments';
    const wrapper = await mountTab();
    await wrapper.find(tab('new')).trigger('click');
    expect(wrapper.text()).toContain('New group policy');
    expect((wrapper.find(tid('name')).element as HTMLInputElement).value).toBe('');
    expect(replace).toHaveBeenLastCalledWith({ query: { tab: 'groupPolicies' } });
  });

  it('creates a policy, closes the editor and reports the result with warnings', async () => {
    vi.mocked(createGroupPolicy).mockResolvedValue(write(3, ["No trigger matches 'x'"]) as never);
    const wrapper = await mountTab();
    await wrapper.find(tab('new')).trigger('click');
    await wrapper.find(tid('name')).setValue('batch');
    await wrapper.find(tid('update-mode')).setValue('notify');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(createGroupPolicy).toHaveBeenCalledWith('batch', {
      updatePolicy: {},
      actions: { updateMode: 'notify' },
    });
    expect(wrapper.find(tid('save')).exists()).toBe(false);
    expect(wrapper.find(tab('status')).text()).toContain('Policy saved. 3 containers updated.');
    expect(wrapper.find(tab('warnings')).text()).toContain("No trigger matches 'x'");
    expect(listGroupPolicies).toHaveBeenCalledTimes(2);
  });

  it('replaces with the policy revision and never runs an update', async () => {
    const wrapper = await mountTab();
    await wrapper.findAll(tab('edit'))[0].trigger('click');
    await wrapper.find(tid('min-age')).setValue('9');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(replaceGroupPolicy).toHaveBeenCalledWith('p1', 2, {
      updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 9, skipTags: ['1.0'] },
      actions: { updateMode: 'manual', exclude: ['docker.local'] },
    });
    expect(wrapper.find(tab('status')).exists()).toBe(true);
    expect(wrapper.find(tab('warnings')).exists()).toBe(false);
  });

  it('keeps the draft on a stale revision and reloads on request', async () => {
    vi.mocked(replaceGroupPolicy).mockRejectedValue(new GroupPolicyHttpError(409, 'stale'));
    const wrapper = await mountTab();
    await wrapper.findAll(tab('edit'))[0].trigger('click');
    await wrapper.find(tid('min-age')).setValue('9');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('conflict')).exists()).toBe(true);
    expect((wrapper.find(tid('min-age')).element as HTMLInputElement).value).toBe('9');
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
    vi.mocked(listGroupPolicies).mockResolvedValue([
      policy({ revision: 3, updatePolicy: { maturityMinAgeDays: 20 } }),
    ]);
    await wrapper.find(tid('reload')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('conflict')).exists()).toBe(false);
    expect((wrapper.find(tid('min-age')).element as HTMLInputElement).value).toBe('20');
  });

  it('shows a server validation message at its field and keeps the editor open', async () => {
    vi.mocked(replaceGroupPolicy).mockRejectedValue(
      new GroupPolicyHttpError(400, 'Invalid group update policy: "skipTags[0]" bad'),
    );
    const wrapper = await mountTab();
    await wrapper.findAll(tab('edit'))[0].trigger('click');
    await wrapper.find(tid('skip-tags')).setValue('x');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('error-skipTags')).text()).toContain('skipTags[0]');
    expect(wrapper.find(tid('save')).exists()).toBe(true);
    expect(wrapper.find(tab('status')).exists()).toBe(false);
  });

  it('turns read-only after a forbidden write and hides the new button', async () => {
    vi.mocked(replaceGroupPolicy).mockRejectedValue(new GroupPolicyHttpError(403, 'Forbidden'));
    const wrapper = await mountTab();
    await wrapper.findAll(tab('edit'))[0].trigger('click');
    await wrapper.find(tid('min-age')).setValue('9');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('forbidden')).exists()).toBe(true);
    expect(wrapper.find(tid('save')).exists()).toBe(false);
    expect(wrapper.find(tab('new')).exists()).toBe(false);
  });

  it('closes the editor on cancel and clears the link', async () => {
    const wrapper = await mountTab();
    await wrapper.findAll(tab('edit'))[0].trigger('click');
    await wrapper.find(tid('cancel')).trigger('click');
    expect(wrapper.find(tid('save')).exists()).toBe(false);
    expect(replace).toHaveBeenLastCalledWith({ query: { tab: 'groupPolicies' } });
  });
});

describe('ConfigGroupPoliciesTab remove', () => {
  it('asks for confirmation and removes with the revision', async () => {
    const wrapper = await mountTab();
    await wrapper.findAll(tab('edit'))[0].trigger('click');
    await wrapper.find(tid('remove')).trigger('click');
    const { visible, current } = useConfirmDialog();
    expect(visible.value).toBe(true);
    expect(current.value?.message).toContain('payments');
    expect(deleteGroupPolicy).not.toHaveBeenCalled();
    await useConfirmDialog().accept();
    await flushPromises();
    expect(deleteGroupPolicy).toHaveBeenCalledWith('p1', 2);
    expect(wrapper.find(tid('save')).exists()).toBe(false);
    expect(wrapper.find(tab('status')).text()).toContain('Policy removed. 2 containers updated.');
  });

  it('does not remove when the dialog is dismissed', async () => {
    const wrapper = await mountTab();
    await wrapper.findAll(tab('edit'))[0].trigger('click');
    await wrapper.find(tid('remove')).trigger('click');
    useConfirmDialog().reject();
    expect(deleteGroupPolicy).not.toHaveBeenCalled();
  });

  it('keeps the editor open and shows the failure when remove is stale', async () => {
    vi.mocked(deleteGroupPolicy).mockRejectedValue(new GroupPolicyHttpError(409, 'stale'));
    const wrapper = await mountTab();
    await wrapper.findAll(tab('edit'))[0].trigger('click');
    await wrapper.find(tid('remove')).trigger('click');
    await useConfirmDialog().accept();
    await flushPromises();
    expect(wrapper.find(tid('conflict')).exists()).toBe(true);
    expect(wrapper.find(tab('status')).exists()).toBe(false);
  });
});
