import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import ContainerFullPageActionsTab from '@/components/containers/ContainerFullPageActionsTab.vue';

const ctx = vi.hoisted(() => ({ value: {} as Record<string, any> }));

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => ctx.value,
}));

function makeContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'container-1',
    name: 'nginx',
    newTag: '1.1',
    bouncer: 'safe',
    updateEligibility: undefined,
    ...overrides,
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  const base: Record<string, any> = {
    selectedContainer: ref(makeContainer()),
    previewLoading: ref(false),
    runContainerPreview: vi.fn(),
    actionInProgress: ref(new Map()),
    policyInProgress: ref(null),
    skipCurrentForSelected: vi.fn(),
    snoozeSelected: vi.fn(),
    snoozeDateInput: ref(''),
    snoozeSelectedUntilDate: vi.fn(),
    selectedSnoozeUntil: ref(''),
    unsnoozeSelected: vi.fn(),
    selectedSkipTags: ref<string[]>([]),
    selectedSkipDigests: ref<string[]>([]),
    clearSkipsSelected: vi.fn(),
    selectedUpdatePolicy: ref<Record<string, unknown>>({}),
    selectedHasMaturityPolicy: ref(false),
    selectedMaturityMode: ref('all'),
    selectedMaturityMinAgeDays: ref(7),
    maturityModeInput: ref('all'),
    maturityMinAgeDaysInput: ref(7),
    setMaturityPolicySelected: vi.fn(),
    clearMaturityPolicySelected: vi.fn(),
    confirmClearPolicy: vi.fn(),
    policyMessage: ref(''),
    policyError: ref(''),
    removeSkipTagSelected: vi.fn(),
    removeSkipDigestSelected: vi.fn(),
    detailPreview: ref<Record<string, any> | null>(null),
    detailComposePreview: ref<Record<string, any> | null>(null),
    previewError: ref(''),
    previewErrorAction: ref<{ href: string; label: string } | null>(null),
    triggersLoading: ref(false),
    detailTriggers: ref<Record<string, any>[]>([]),
    getTriggerKey: (trigger: { type: string; name: string }) => `${trigger.type}.${trigger.name}`,
    triggerRunInProgress: ref<string | null>(null),
    runAssociatedTrigger: vi.fn(),
    triggerMessage: ref(''),
    triggerError: ref(''),
    backupsLoading: ref(false),
    detailBackups: ref<Record<string, any>[]>([]),
    rollbackInProgress: ref<string | null>(null),
    confirmRollback: vi.fn(),
    rollbackMessage: ref(''),
    rollbackError: ref(''),
    updateOperationsLoading: ref(false),
    detailUpdateOperations: ref<Record<string, any>[]>([]),
    getOperationStatusStyle: () => ({}),
    formatOperationStatus: (status: string) => `status:${status}`,
    formatOperationPhase: (phase: string) => `phase:${phase}`,
    formatRollbackReason: (reason: string) => `reason:${reason}`,
    updateOperationsError: ref(''),
    scanContainer: vi.fn(),
    confirmUpdate: vi.fn(),
    confirmForceUpdate: vi.fn(),
    formatTimestamp: (value: string) => `ts:${value}`,
  };
  return { ...base, ...overrides };
}

function mountComponent() {
  return mount(ContainerFullPageActionsTab, {
    global: {
      stubs: { AppIcon: { template: '<span class="app-icon-stub" />', props: ['name', 'size'] } },
    },
  });
}

function buttonByText(wrapper: ReturnType<typeof mountComponent>, text: string) {
  const found = wrapper.findAll('button').find((button) => button.text().includes(text));
  if (!found) {
    throw new Error(`button not found: ${text}`);
  }
  return found;
}

describe('ContainerFullPageActionsTab', () => {
  beforeEach(() => {
    ctx.value = makeContext();
  });

  describe('update workflow buttons', () => {
    it('runs the preview, update and scan handlers for the selected container', async () => {
      const wrapper = mountComponent();

      await buttonByText(wrapper, 'Preview Update').trigger('click');
      await buttonByText(wrapper, 'Update Now').trigger('click');
      await buttonByText(wrapper, 'Scan Now').trigger('click');

      expect(ctx.value.runContainerPreview).toHaveBeenCalledOnce();
      expect(ctx.value.confirmUpdate).toHaveBeenCalledWith(ctx.value.selectedContainer.value);
      expect(ctx.value.scanContainer).toHaveBeenCalledWith(ctx.value.selectedContainer.value);
    });

    it('shows the previewing label and disables the preview button while loading', () => {
      ctx.value.previewLoading.value = true;

      const wrapper = mountComponent();

      const button = buttonByText(wrapper, 'Previewing...');
      expect(button.attributes('disabled')).toBeDefined();
    });

    it('disables Update Now when there is no new tag or an action is already running', async () => {
      ctx.value.selectedContainer.value = makeContainer({ newTag: undefined });
      const noTag = mountComponent();
      expect(buttonByText(noTag, 'Update Now').attributes('disabled')).toBeDefined();

      ctx.value.selectedContainer.value = makeContainer();
      ctx.value.actionInProgress.value = new Map([['container-1', 'update']]);
      const busy = mountComponent();
      expect(buttonByText(busy, 'Update Now').attributes('disabled')).toBeDefined();
    });

    it('offers Force Update for a bouncer-blocked container', async () => {
      ctx.value.selectedContainer.value = makeContainer({ bouncer: 'blocked' });

      const wrapper = mountComponent();
      await buttonByText(wrapper, 'Force Update').trigger('click');

      expect(ctx.value.confirmForceUpdate).toHaveBeenCalledWith(ctx.value.selectedContainer.value);
      expect(wrapper.text()).not.toContain('Update Now');
    });

    it('shows a disabled Blocked button for a hard-blocked update', () => {
      ctx.value.selectedContainer.value = makeContainer({
        updateEligibility: {
          eligible: false,
          blockers: [
            { reason: 'security-scan-blocked', message: 'Blocked by scan', severity: 'hard' },
          ],
        },
      });

      const wrapper = mountComponent();

      const blocked = buttonByText(wrapper, 'Blocked');
      expect(blocked.attributes('disabled')).toBeDefined();
      expect(wrapper.text()).not.toContain('Update Now');
      expect(wrapper.text()).not.toContain('Force Update');
    });

    it('switches to preview-only wording and explains the condition for a dry-run action trigger', () => {
      ctx.value.detailTriggers.value = [
        { type: 'docker', name: 'local', configuration: { dryrun: true } },
      ];

      const wrapper = mountComponent();

      expect(wrapper.get('[data-test="dry-run-update-action"]').text()).toBe('Preview only');
      expect(wrapper.get('[data-test="dry-run-trigger-condition"]').text()).toContain(
        'docker.local',
      );
    });
  });

  describe('skip, snooze and maturity controls', () => {
    it('calls the snooze and skip handlers', async () => {
      const wrapper = mountComponent();

      await buttonByText(wrapper, 'Skip This Update').trigger('click');
      await buttonByText(wrapper, 'Snooze 1d').trigger('click');
      await buttonByText(wrapper, 'Snooze 7d').trigger('click');

      expect(ctx.value.skipCurrentForSelected).toHaveBeenCalledOnce();
      expect(ctx.value.snoozeSelected.mock.calls).toEqual([[1], [7]]);
    });

    it('enables Snooze Until and Unsnooze only when they have something to act on', async () => {
      const idle = mountComponent();
      expect(buttonByText(idle, 'Snooze Until').attributes('disabled')).toBeDefined();
      expect(buttonByText(idle, 'Unsnooze').attributes('disabled')).toBeDefined();

      ctx.value.snoozeDateInput.value = '2030-01-01';
      ctx.value.selectedSnoozeUntil.value = '2030-01-01T00:00:00Z';
      const active = mountComponent();
      await buttonByText(active, 'Snooze Until').trigger('click');
      await buttonByText(active, 'Unsnooze').trigger('click');

      expect(ctx.value.snoozeSelectedUntilDate).toHaveBeenCalledOnce();
      expect(ctx.value.unsnoozeSelected).toHaveBeenCalledOnce();
      expect(active.text()).toContain('Snoozed until:');
      expect(active.text()).toContain('ts:2030-01-01T00:00:00Z');
    });

    it('applies and clears the maturity policy', async () => {
      ctx.value.maturityModeInput.value = 'mature';
      ctx.value.selectedHasMaturityPolicy.value = true;
      ctx.value.selectedMaturityMode.value = 'mature';
      ctx.value.selectedMaturityMinAgeDays.value = 14;

      const wrapper = mountComponent();
      await buttonByText(wrapper, 'Apply Maturity').trigger('click');
      await buttonByText(wrapper, 'Clear Maturity').trigger('click');

      expect(ctx.value.setMaturityPolicySelected).toHaveBeenCalledWith('mature');
      expect(ctx.value.clearMaturityPolicySelected).toHaveBeenCalledOnce();
      expect(wrapper.text()).toContain('Mature only (14d minimum)');
    });

    it('describes an allow-all maturity policy', () => {
      ctx.value.selectedHasMaturityPolicy.value = true;
      ctx.value.selectedMaturityMode.value = 'all';

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Allow all updates');
    });

    it('disables every policy control while a policy change is in flight', () => {
      ctx.value.policyInProgress.value = 'snooze';
      ctx.value.snoozeDateInput.value = '2030-01-01';

      const wrapper = mountComponent();

      for (const label of ['Snooze 1d', 'Snooze 7d', 'Apply Maturity']) {
        expect(buttonByText(wrapper, label).attributes('disabled')).toBeDefined();
      }
      expect(wrapper.get('input[type="date"]').attributes('disabled')).toBeDefined();
    });
  });

  describe('reset group and active policy summary', () => {
    it('says there is no active policy when nothing is set', () => {
      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('No active update policy.');
      expect(buttonByText(wrapper, 'Clear Skips').attributes('disabled')).toBeDefined();
      expect(buttonByText(wrapper, 'Clear Policy').attributes('disabled')).toBeDefined();
    });

    it('lists skipped tags and digests and removes them individually', async () => {
      ctx.value.selectedSkipTags.value = ['1.2.0'];
      ctx.value.selectedSkipDigests.value = ['sha256:abc'];
      ctx.value.selectedUpdatePolicy.value = { skipTags: ['1.2.0'] };

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Skipped tags:');
      expect(wrapper.text()).toContain('1.2.0');
      expect(wrapper.text()).toContain('Skipped digests:');
      expect(wrapper.text()).toContain('sha256:abc');
      expect(wrapper.text()).not.toContain('No active update policy.');

      const removeButtons = wrapper.findAll('span.font-mono button');
      expect(removeButtons).toHaveLength(2);
      await removeButtons[0].trigger('click');
      await removeButtons[1].trigger('click');
      expect(ctx.value.removeSkipTagSelected).toHaveBeenCalledWith('1.2.0');
      expect(ctx.value.removeSkipDigestSelected).toHaveBeenCalledWith('sha256:abc');

      await buttonByText(wrapper, 'Clear Skips').trigger('click');
      await buttonByText(wrapper, 'Clear Policy').trigger('click');
      expect(ctx.value.clearSkipsSelected).toHaveBeenCalledOnce();
      expect(ctx.value.confirmClearPolicy).toHaveBeenCalledOnce();
    });

    it('shows policy success and error messages', () => {
      ctx.value.policyMessage.value = 'Policy saved';
      ctx.value.policyError.value = 'Policy failed';

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Policy saved');
      expect(wrapper.text()).toContain('Policy failed');
    });
  });

  describe('preview section', () => {
    it('shows the empty state, then the loading state', () => {
      const empty = mountComponent();
      expect(empty.text()).toContain('Run a preview to inspect the planned update operations.');

      ctx.value.previewLoading.value = true;
      const loading = mountComponent();
      expect(loading.text()).toContain('Generating preview...');
    });

    it('renders the preview details and the compose preview', () => {
      ctx.value.detailPreview.value = {
        currentImage: 'nginx:1.0',
        newImage: 'nginx:1.1',
        updateKind: 'minor',
        isRunning: true,
        networks: ['bridge', 'internal'],
      };
      ctx.value.detailComposePreview.value = {
        files: ['/a/compose.yml', '/b/compose.yml'],
        service: 'web',
        writableFile: '/a/compose.yml',
        willWrite: false,
        patch: '- image: nginx:1.0\n+ image: nginx:1.1',
      };

      const wrapper = mountComponent();
      const text = wrapper.text();

      expect(text).toContain('nginx:1.0');
      expect(text).toContain('nginx:1.1');
      expect(text).toContain('Running:');
      expect(text).toContain('bridge, internal');
      expect(text).toContain('Compose files:');
      expect(text).toContain('/a/compose.yml, /b/compose.yml');
      expect(text).toContain('Compose service:');
      expect(text).toContain('web');
      expect(text).toContain('Writable file:');
      expect(text).toContain('Writes compose file:');
      expect(text).toContain('Patch preview:');
      expect(wrapper.get('pre').text()).toContain('+ image: nginx:1.1');
    });

    it('uses the singular compose file label and dashes for missing images', () => {
      ctx.value.detailPreview.value = { isRunning: false, updateKind: undefined };
      ctx.value.detailComposePreview.value = { files: ['/a/compose.yml'], willWrite: true };

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Compose file:');
      expect(wrapper.text()).not.toContain('Compose files:');
      expect(wrapper.text()).toContain('Writes compose file:');
    });

    it('shows a preview error instead of details', () => {
      ctx.value.detailPreview.value = { error: 'preview exploded' };

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('preview exploded');
      expect(wrapper.text()).not.toContain('Update kind:');
    });

    it('shows the request error and its action link', () => {
      ctx.value.previewError.value = 'Cannot preview';
      ctx.value.previewErrorAction.value = { href: '/config/triggers', label: 'Open triggers' };

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Cannot preview');
      const link = wrapper.get('[data-test="preview-error-action"]');
      expect(link.attributes('href')).toBe('/config/triggers');
      expect(link.text()).toBe('Open triggers');
    });
  });

  describe('associated triggers', () => {
    it('shows the empty and loading states', () => {
      expect(mountComponent().text()).toContain('No triggers associated with this container');

      ctx.value.triggersLoading.value = true;
      expect(mountComponent().text()).toContain('Loading triggers...');
    });

    it('lists triggers with agent and Auto badge and runs one', async () => {
      const auto = { type: 'docker', name: 'local', agent: 'edge', resolvedState: 'auto' };
      const manual = { type: 'slack', name: 'ops', resolvedState: 'manual' };
      ctx.value.detailTriggers.value = [auto, manual];
      ctx.value.triggerMessage.value = 'Trigger ran';
      ctx.value.triggerError.value = 'Trigger failed';

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('docker.local');
      expect(wrapper.text()).toContain('agent: edge');
      expect(wrapper.text()).toContain('slack.ops');
      expect(wrapper.text().match(/Auto/g)).toHaveLength(1);
      expect(wrapper.text()).toContain('Trigger ran');
      expect(wrapper.text()).toContain('Trigger failed');

      const runButtons = wrapper.findAll('button').filter((button) => button.text() === 'Run');
      expect(runButtons).toHaveLength(2);
      await runButtons[1].trigger('click');
      expect(ctx.value.runAssociatedTrigger).toHaveBeenCalledWith(manual);
    });

    it('shows Running... on the active trigger and disables the others', () => {
      ctx.value.detailTriggers.value = [
        { type: 'docker', name: 'local' },
        { type: 'slack', name: 'ops' },
      ];
      ctx.value.triggerRunInProgress.value = 'slack.ops';

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Running...');
      const triggerButtons = wrapper
        .findAll('button')
        .filter((button) => ['Run', 'Running...'].includes(button.text()));
      expect(triggerButtons.every((button) => button.attributes('disabled') !== undefined)).toBe(
        true,
      );
    });
  });

  describe('backups and rollback', () => {
    it('shows the empty state and disables rollback without backups', () => {
      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('No backups available');
      expect(buttonByText(wrapper, 'Rollback').attributes('disabled')).toBeDefined();
    });

    it('lists backups and rolls back to the latest or a specific one', async () => {
      ctx.value.detailBackups.value = [
        { id: 'b1', imageName: 'nginx', imageTag: '1.0', timestamp: '2030-01-01' },
      ];
      ctx.value.rollbackMessage.value = 'Rolled back';
      ctx.value.rollbackError.value = 'Rollback failed';

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('nginx:1.0');
      expect(wrapper.text()).toContain('ts:2030-01-01');
      expect(wrapper.text()).toContain('Rolled back');
      expect(wrapper.text()).toContain('Rollback failed');

      await buttonByText(wrapper, 'Use').trigger('click');
      expect(ctx.value.confirmRollback).toHaveBeenCalledWith('b1');

      const latest = wrapper
        .findAll('button')
        .find((button) => button.text().toLowerCase().includes('latest'));
      await latest!.trigger('click');
      expect(ctx.value.confirmRollback).toHaveBeenLastCalledWith();
    });

    it('shows loading and in-progress labels', () => {
      ctx.value.backupsLoading.value = true;
      ctx.value.detailBackups.value = [
        { id: 'b1', imageName: 'nginx', imageTag: '1.0', timestamp: '2030-01-01' },
      ];
      ctx.value.rollbackInProgress.value = 'latest';

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Rolling back');

      ctx.value.backupsLoading.value = false;
      ctx.value.rollbackInProgress.value = 'b1';
      const specific = mountComponent();
      expect(specific.text()).toContain('Rolling...');
    });
  });

  describe('update operation history', () => {
    it('shows the empty and loading states plus errors', () => {
      expect(mountComponent().text()).toContain('No update operations');

      ctx.value.updateOperationsLoading.value = true;
      expect(mountComponent().text()).toContain('Loading');

      ctx.value.updateOperationsLoading.value = false;
      ctx.value.updateOperationsError.value = 'history failed';
      expect(mountComponent().text()).toContain('history failed');
    });

    it('renders an operation with versions, rollback reason and last error', () => {
      ctx.value.detailUpdateOperations.value = [
        {
          id: 'op-1',
          status: 'failed',
          phase: 'pulling',
          fromVersion: '1.0',
          toVersion: '1.1',
          rollbackReason: 'health-check',
          lastError: 'pull denied',
          updatedAt: '2030-02-02',
          createdAt: '2030-01-01',
        },
      ];

      const wrapper = mountComponent();
      const text = wrapper.text();

      expect(text).toContain('op-1');
      expect(text).toContain('status:failed');
      expect(text).toContain('phase:pulling');
      expect(text).toContain('1.0');
      expect(text).toContain('1.1');
      expect(text).toContain('reason:health-check');
      expect(text).toContain('pull denied');
      expect(text).toContain('ts:2030-02-02');
    });

    it('falls back to question marks, omits optional rows and uses createdAt', () => {
      ctx.value.detailUpdateOperations.value = [
        {
          id: 'op-2',
          status: 'queued',
          phase: 'queued',
          toVersion: '2.0',
          createdAt: '2030-03-03',
        },
      ];

      const wrapper = mountComponent();
      const text = wrapper.text();

      expect(text).toContain('?');
      expect(text).toContain('2.0');
      expect(text).toContain('ts:2030-03-03');
      expect(text).not.toContain('reason:');
      expect(text).not.toContain('Last error');
    });
  });
});
