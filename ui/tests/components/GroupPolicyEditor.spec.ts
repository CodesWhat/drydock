import { mount } from '@vue/test-utils';
import GroupPolicyEditor from '@/components/GroupPolicyEditor.vue';
import type { GroupPolicyFailure } from '@/composables/useGroupPolicies';
import type { GroupPolicy } from '@/services/group-policy';

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
    members: { count: 2, agents: [null] },
    ...overrides,
  };
}

function mountEditor(props: Record<string, unknown> = {}) {
  return mount(GroupPolicyEditor, {
    props: {
      group: '',
      nameEditable: true,
      globalUpdateMode: 'auto',
      saving: false,
      failure: null,
      readOnly: false,
      triggerSuggestions: [],
      ...props,
    },
  });
}

const tid = (id: string) => `[data-testid="group-policy-${id}"]`;

describe('GroupPolicyEditor', () => {
  describe('create', () => {
    it('starts empty with save disabled and says why', () => {
      const wrapper = mountEditor();
      expect(wrapper.text()).toContain('New group policy');
      expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
      expect(wrapper.text()).toContain('Set at least one field, or remove the policy.');
      expect(wrapper.find(tid('remove')).exists()).toBe(false);
    });

    it('emits the exact name and the built body', async () => {
      const wrapper = mountEditor();
      await wrapper.find(tid('name')).setValue(' Pay ments ');
      await wrapper.find(tid('maturity-mode')).setValue('mature');
      await wrapper.find(tid('min-age')).setValue('14');
      await wrapper.find(tid('skip-tags')).setValue('1.0, 2.0');
      await wrapper.find(tid('update-mode')).setValue('notify');
      await wrapper.find(tid('exclude')).setValue('docker.local:major');
      await wrapper.find(tid('save')).trigger('click');
      expect(wrapper.emitted('save')).toEqual([
        [
          {
            group: ' Pay ments ',
            body: {
              updatePolicy: {
                maturityMode: 'mature',
                maturityMinAgeDays: 14,
                skipTags: ['1.0', '2.0'],
              },
              actions: { updateMode: 'notify', exclude: ['docker.local:major'] },
            },
          },
        ],
      ]);
    });

    it('rejects a blank name before asking the server', async () => {
      const wrapper = mountEditor();
      await wrapper.find(tid('name')).setValue('   ');
      await wrapper.find(tid('maturity-mode')).setValue('all');
      expect(wrapper.find(tid('error-group')).text()).toBe('Enter a group name that is not blank.');
      expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
    });

    it('does not offer automatic updates as a group choice', () => {
      const wrapper = mountEditor();
      const values = wrapper
        .find(tid('update-mode'))
        .findAll('option')
        .map((o) => o.element.value);
      expect(values).toEqual(['', 'manual', 'notify']);
      expect(wrapper.text()).toContain('Group rules can only restrict. Current global mode: Auto.');
    });

    it('shows the raw global mode when it has no label', () => {
      const wrapper = mountEditor({ globalUpdateMode: 'custom' });
      expect(wrapper.text()).toContain('Current global mode: custom.');
    });

    it('states where the policy is stored', () => {
      expect(mountEditor().text()).toContain(
        'Stored in Drydock, not in Docker labels. Labels and per-container overrides on members still win for update-policy fields.',
      );
    });
  });

  describe('edit', () => {
    it('prefills the draft and fixes the group name', () => {
      const wrapper = mountEditor({ group: 'payments', nameEditable: false, policy: policy() });
      expect(wrapper.text()).toContain('Group policy: payments');
      expect(wrapper.find(tid('name')).exists()).toBe(false);
      expect((wrapper.find(tid('maturity-mode')).element as HTMLSelectElement).value).toBe(
        'mature',
      );
      expect((wrapper.find(tid('min-age')).element as HTMLInputElement).value).toBe('7');
      expect((wrapper.find(tid('skip-tags')).element as HTMLTextAreaElement).value).toBe('1.0');
      expect((wrapper.find(tid('update-mode')).element as HTMLSelectElement).value).toBe('manual');
      expect((wrapper.find(tid('exclude')).element as HTMLTextAreaElement).value).toBe(
        'docker.local',
      );
    });

    it('renders edge whitespace in the name visibly', () => {
      const wrapper = mountEditor({
        group: ' pay ',
        nameEditable: false,
        policy: policy({ group: ' pay ' }),
      });
      expect(wrapper.text()).toContain('Group policy: ␣pay␣');
      expect(wrapper.text()).toContain('The name has leading or trailing whitespace, shown as ␣.');
    });

    it('sends the cleared fields as an omitted body on save', async () => {
      const wrapper = mountEditor({ group: 'payments', nameEditable: false, policy: policy() });
      await wrapper.find(tid('maturity-mode')).setValue('');
      await wrapper.find(tid('min-age')).setValue('');
      await wrapper.find(tid('skip-tags')).setValue('');
      await wrapper.find(tid('exclude')).setValue('');
      await wrapper.find(tid('save')).trigger('click');
      expect(wrapper.emitted('save')?.[0]).toEqual([
        { group: 'payments', body: { updatePolicy: {}, actions: { updateMode: 'manual' } } },
      ]);
    });

    it('resets the draft when a newer revision arrives', async () => {
      const wrapper = mountEditor({ group: 'payments', nameEditable: false, policy: policy() });
      await wrapper.find(tid('min-age')).setValue('30');
      await wrapper.setProps({
        policy: policy({ revision: 3, updatePolicy: { maturityMinAgeDays: 9 } }),
      });
      expect((wrapper.find(tid('min-age')).element as HTMLInputElement).value).toBe('9');
    });

    it('keeps the draft when the same revision is passed again', async () => {
      const wrapper = mountEditor({ group: 'payments', nameEditable: false, policy: policy() });
      await wrapper.find(tid('min-age')).setValue('30');
      await wrapper.setProps({ policy: policy() });
      expect((wrapper.find(tid('min-age')).element as HTMLInputElement).value).toBe('30');
    });

    it('emits remove and cancel', async () => {
      const wrapper = mountEditor({ group: 'payments', nameEditable: false, policy: policy() });
      await wrapper.find(tid('remove')).trigger('click');
      await wrapper.find(tid('cancel')).trigger('click');
      expect(wrapper.emitted('remove')).toHaveLength(1);
      expect(wrapper.emitted('cancel')).toHaveLength(1);
    });
  });

  describe('validation', () => {
    it('flags a min age outside 1 to 365', async () => {
      const wrapper = mountEditor({ group: 'g' });
      await wrapper.find(tid('maturity-mode')).setValue('all');
      await wrapper.find(tid('name')).setValue('g');
      await wrapper.find(tid('min-age')).setValue('400');
      expect(wrapper.find(tid('error-maturityMinAgeDays')).text()).toBe(
        'Enter a whole number from 1 to 365.',
      );
      expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
    });

    it('shows a server validation message next to its field', () => {
      const failure: GroupPolicyFailure = {
        kind: 'validation',
        message: 'Invalid group action rules: "a,b" is not a trigger reference',
        field: 'exclude',
      };
      const wrapper = mountEditor({ failure });
      expect(wrapper.find(tid('error-exclude')).text()).toBe(failure.message);
      expect(wrapper.find(tid('error-form')).exists()).toBe(false);
    });

    it('shows a form-level server message', () => {
      const wrapper = mountEditor({
        failure: { kind: 'validation', message: 'must set a field', field: 'form' },
      });
      expect(wrapper.find(tid('error-form')).text()).toBe('must set a field');
    });

    it('shows a duplicate group on the name', () => {
      const wrapper = mountEditor({
        failure: {
          kind: 'exists',
          message: "A policy for group 'x' already exists",
          field: 'group',
        },
      });
      expect(wrapper.find(tid('error-group')).text()).toContain('already exists');
    });

    it('shows an unknown failure as a form message', () => {
      const wrapper = mountEditor({
        failure: { kind: 'unknown', message: 'boom', field: 'form' },
      });
      expect(wrapper.find(tid('error-form')).text()).toBe('boom');
    });
  });

  describe('conflict and access', () => {
    it('keeps the draft, blocks saving and asks for a reload on a stale revision', async () => {
      const wrapper = mountEditor({
        group: 'payments',
        nameEditable: false,
        policy: policy(),
        failure: { kind: 'conflict', message: 'stale', field: 'form' },
      });
      expect(wrapper.find(tid('conflict')).text()).toContain(
        'This policy was changed by someone else. Reload it, then apply your change again.',
      );
      expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
      expect((wrapper.find(tid('min-age')).element as HTMLInputElement).value).toBe('7');
      await wrapper.find(tid('reload')).trigger('click');
      expect(wrapper.emitted('reload')).toHaveLength(1);
    });

    it('asks for a reload when the policy is gone', async () => {
      const wrapper = mountEditor({
        group: 'payments',
        nameEditable: false,
        policy: policy(),
        failure: { kind: 'notFound', message: 'gone', field: 'form' },
      });
      expect(wrapper.find(tid('conflict')).text()).toContain('This policy no longer exists.');
      await wrapper.find(tid('reload')).trigger('click');
      expect(wrapper.emitted('reload')).toHaveLength(1);
    });

    it('turns read-only after the server refuses a write', () => {
      const wrapper = mountEditor({
        group: 'payments',
        nameEditable: false,
        policy: policy(),
        readOnly: true,
        failure: { kind: 'forbidden', message: 'Forbidden', field: 'form' },
      });
      expect(wrapper.text()).toContain('Admin access is required to change group policies.');
      expect(wrapper.find(tid('save')).exists()).toBe(false);
      expect(wrapper.find(tid('remove')).exists()).toBe(false);
      expect(wrapper.find(tid('min-age')).attributes('disabled')).toBeDefined();
      expect(wrapper.find(tid('maturity-mode')).attributes('disabled')).toBeDefined();
      expect(wrapper.find(tid('cancel')).exists()).toBe(true);
    });

    it('shows the read-only notice without a failure', () => {
      const wrapper = mountEditor({ readOnly: true });
      expect(wrapper.text()).toContain('Only admins can change group policies.');
    });

    it('disables save and remove while a write is running', () => {
      const wrapper = mountEditor({
        group: 'payments',
        nameEditable: false,
        policy: policy(),
        saving: true,
      });
      expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
      expect(wrapper.find(tid('remove')).attributes('disabled')).toBeDefined();
    });
  });

  describe('trigger suggestions', () => {
    it('adds a suggestion once and not twice', async () => {
      const wrapper = mountEditor({ triggerSuggestions: ['docker.local', 'command.backup'] });
      await wrapper.find(tid('suggest-docker.local')).trigger('click');
      await wrapper.find(tid('suggest-command.backup')).trigger('click');
      await wrapper.find(tid('suggest-docker.local')).trigger('click');
      expect((wrapper.find(tid('exclude')).element as HTMLTextAreaElement).value).toBe(
        'docker.local\ncommand.backup',
      );
    });

    it('renders no suggestion row without triggers', () => {
      expect(mountEditor().find(tid('suggestions')).exists()).toBe(false);
    });
  });
});

describe('GroupPolicyEditor stale server messages', () => {
  it('hides a field message once the draft changes and shows the next one', async () => {
    const wrapper = mountEditor({
      failure: { kind: 'validation', message: 'bad tags', field: 'skipTags' },
    });
    expect(wrapper.find(tid('error-skipTags')).text()).toBe('bad tags');
    await wrapper.find(tid('skip-tags')).setValue('1.0');
    expect(wrapper.find(tid('error-skipTags')).exists()).toBe(false);
    await wrapper.setProps({
      failure: { kind: 'validation', message: 'bad digests', field: 'skipDigests' },
    });
    expect(wrapper.find(tid('error-skipDigests')).text()).toBe('bad digests');
    expect(wrapper.find(tid('error-skipTags')).exists()).toBe(false);
  });

  it('shows server messages for the remaining fields', () => {
    for (const field of ['maturityMode', 'maturityMinAgeDays', 'updateMode'] as const) {
      const wrapper = mountEditor({
        failure: { kind: 'validation', message: `bad ${field}`, field },
      });
      expect(wrapper.find(tid(`error-${field}`)).text()).toBe(`bad ${field}`);
    }
  });
});
