import { mount } from '@vue/test-utils';
import ContainerItem from '@/components/ContainerItem';

const {
  mockGetContainerTriggers,
  mockRefreshContainer,
  mockRunTrigger,
  mockUpdateContainerPolicy,
  mockStartContainer,
  mockStopContainer,
  mockRestartContainer,
  mockGetEffectiveDisplayIcon,
  mockGetRegistryProviderIcon,
} = vi.hoisted(() => ({
  mockGetContainerTriggers: vi.fn(),
  mockRefreshContainer: vi.fn(),
  mockRunTrigger: vi.fn(),
  mockUpdateContainerPolicy: vi.fn(),
  mockStartContainer: vi.fn(),
  mockStopContainer: vi.fn(),
  mockRestartContainer: vi.fn(),
  mockGetEffectiveDisplayIcon: vi.fn(),
  mockGetRegistryProviderIcon: vi.fn(),
}));

vi.mock('@/services/container', () => ({
  getContainerTriggers: mockGetContainerTriggers,
  refreshContainer: mockRefreshContainer,
  runTrigger: mockRunTrigger,
  updateContainerPolicy: mockUpdateContainerPolicy,
}));

vi.mock('@/services/container-actions', () => ({
  startContainer: mockStartContainer,
  stopContainer: mockStopContainer,
  restartContainer: mockRestartContainer,
}));

vi.mock('@/services/image-icon', () => ({
  getEffectiveDisplayIcon: mockGetEffectiveDisplayIcon,
}));

vi.mock('@/services/registry', () => ({
  getRegistryProviderIcon: mockGetRegistryProviderIcon,
}));

const BASE_CONTAINER = {
  id: 'test-container-id',
  name: 'test-container',
  displayName: 'Test Container',
  displayIcon: 'fab fa-docker',
  agent: 'node1',
  watcher: 'local',
  image: {
    name: 'repo/image',
    registry: { name: 'hub' },
    tag: { value: '1.0.0', semver: true },
    created: '2023-01-01T00:00:00Z',
    os: 'linux',
    architecture: 'amd64',
  },
  updateAvailable: true,
  updateKind: {
    kind: 'tag',
    semverDiff: 'minor',
    remoteValue: '1.1.0',
    localValue: '1.0.0',
  },
  result: {
    created: '2023-01-02T00:00:00Z',
    tag: '1.1.0',
  },
  labels: {
    app: 'test-app',
    env: 'production',
  },
  status: 'running',
  updatePolicy: undefined,
};

const createContainer = (overrides: any = {}) => {
  const imageOverrides = overrides.image ?? {};
  const container: any = {
    ...BASE_CONTAINER,
    ...overrides,
    image: {
      ...BASE_CONTAINER.image,
      ...imageOverrides,
      registry: {
        ...BASE_CONTAINER.image.registry,
        ...(imageOverrides.registry ?? {}),
      },
      tag: {
        ...BASE_CONTAINER.image.tag,
        ...(imageOverrides.tag ?? {}),
      },
    },
    labels: {
      ...BASE_CONTAINER.labels,
      ...(overrides.labels ?? {}),
    },
  };

  if (!('updateKind' in overrides)) {
    container.updateKind = BASE_CONTAINER.updateKind;
  }
  if (!('result' in overrides)) {
    container.result = BASE_CONTAINER.result;
  }
  if (!('updatePolicy' in overrides)) {
    container.updatePolicy = BASE_CONTAINER.updatePolicy;
  }

  return container;
};

const mountComponent = (props: any = {}, options: any = {}) =>
  mount(ContainerItem, {
    props: {
      container: createContainer(),
      groupingLabel: '',
      oldestFirst: false,
      ...props,
    },
    ...options,
  });

describe('ContainerItem', () => {
  let wrapper: any;

  beforeEach(() => {
    mockGetContainerTriggers.mockReset();
    mockRefreshContainer.mockReset();
    mockRunTrigger.mockReset();
    mockUpdateContainerPolicy.mockReset();
    mockStartContainer.mockReset();
    mockStopContainer.mockReset();
    mockRestartContainer.mockReset();
    mockGetEffectiveDisplayIcon.mockReset();
    mockGetRegistryProviderIcon.mockReset();

    mockGetEffectiveDisplayIcon.mockImplementation(
      (displayIcon: string) => displayIcon || 'fas fa-cube',
    );
    mockGetRegistryProviderIcon.mockImplementation((provider: string) =>
      provider === 'hub' ? 'fab fa-docker' : 'fas fa-cube',
    );
    mockRefreshContainer.mockResolvedValue(createContainer({ id: 'refreshed' }));
    mockGetContainerTriggers.mockResolvedValue([]);
    mockRunTrigger.mockResolvedValue({});
    mockUpdateContainerPolicy.mockResolvedValue(createContainer({ id: 'policy-updated' }));
    mockStartContainer.mockResolvedValue({ container: createContainer({ id: 'started' }) });
    mockStopContainer.mockResolvedValue({ container: createContainer({ id: 'stopped' }) });
    mockRestartContainer.mockResolvedValue({ container: createContainer({ id: 'restarted' }) });

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(),
      },
    });

    wrapper = mountComponent();
    wrapper.vm.$eventBus.emit.mockClear();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it('renders container information correctly', () => {
    expect(wrapper.text()).toContain('Test Container');
    expect(wrapper.text()).toContain('1.0.0');
    expect(wrapper.text()).toContain('hub');
  });

  it('shows update available indicator when update is available', () => {
    expect(wrapper.vm.newVersion).toBe('1.1.0');
  });

  it('displays correct update severity color for minor update', () => {
    expect(wrapper.vm.newVersionClass).toBe('warning');
  });

  it('displays correct update severity color for major update', async () => {
    await wrapper.setProps({
      container: createContainer({
        updateKind: { ...BASE_CONTAINER.updateKind, semverDiff: 'major' },
      }),
    });
    expect(wrapper.vm.newVersionClass).toBe('error');
  });

  it('displays correct update severity color for patch update', async () => {
    await wrapper.setProps({
      container: createContainer({
        updateKind: { ...BASE_CONTAINER.updateKind, semverDiff: 'patch' },
      }),
    });
    expect(wrapper.vm.newVersionClass).toBe('success');
  });

  it('keeps warning color for non-tag updates', async () => {
    await wrapper.setProps({
      container: createContainer({
        updateKind: {
          kind: 'digest',
          remoteValue: 'sha256:1234567890abcdef1234567890abcdef',
        },
      }),
    });
    expect(wrapper.vm.newVersionClass).toBe('warning');
  });

  it('shows grouping header when grouping label changes', async () => {
    const previousContainer = createContainer({
      labels: { app: 'different-app' },
    });

    await wrapper.setProps({
      groupingLabel: 'app',
      previousContainer,
    });

    expect(wrapper.text()).toContain('app = test-app');
  });

  it('toggles detail view when header is clicked', async () => {
    expect(wrapper.vm.showDetail).toBe(false);
    await wrapper.find('[style*="cursor: pointer"]').trigger('click');
    expect(wrapper.vm.showDetail).toBe(true);
  });

  it('emits delete-container event when delete is called', async () => {
    await wrapper.vm.deleteContainer();
    expect(wrapper.emitted('delete-container')).toBeTruthy();
  });

  it('computes correct registry icon', () => {
    expect(wrapper.vm.registryIcon).toBe('fab fa-docker');
    expect(mockGetRegistryProviderIcon).toHaveBeenCalledWith('hub');
  });

  it('computes effective display icon from service', () => {
    expect(wrapper.vm.effectiveDisplayIcon).toBe('fab fa-docker');
    expect(mockGetEffectiveDisplayIcon).toHaveBeenCalledWith('fab fa-docker', 'repo/image');
  });

  it('computes correct agent status colors', async () => {
    expect(wrapper.vm.agentStatusColor).toBe('info');

    await wrapper.setProps({
      agents: [{ name: 'node1', connected: true }],
    });
    expect(wrapper.vm.agentStatusColor).toBe('success');

    await wrapper.setProps({
      agents: [{ name: 'node1', connected: false }],
    });
    expect(wrapper.vm.agentStatusColor).toBe('error');
  });

  it('returns info status color when agents prop is invalid', async () => {
    await wrapper.setProps({
      agents: null,
    });
    expect(wrapper.vm.agentStatusColor).toBe('info');
  });

  it('computes correct OS icon for linux', () => {
    expect(wrapper.vm.osIcon).toBe('fab fa-linux');
  });

  it('computes correct OS icon for windows and unknown', async () => {
    await wrapper.setProps({
      container: createContainer({
        image: { os: 'windows' },
      }),
    });
    expect(wrapper.vm.osIcon).toBe('fab fa-windows');

    await wrapper.setProps({
      container: createContainer({
        image: { os: 'plan9' },
      }),
    });
    expect(wrapper.vm.osIcon).toBe('fas fa-circle-question');
  });

  it('has showPreview data property defaulting to false', () => {
    expect(wrapper.vm.showPreview).toBe(false);
  });

  it('formats digest version correctly', async () => {
    await wrapper.setProps({
      container: createContainer({
        updateKind: {
          kind: 'digest',
          remoteValue: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef',
        },
      }),
    });
    expect(wrapper.vm.newVersion).toBe('sha256:12345678...');
  });

  it('computes newVersion from result created when remote value is missing', async () => {
    await wrapper.setProps({
      container: createContainer({
        updateKind: undefined,
      }),
    });

    expect(wrapper.vm.newVersion).toBe(new Date('2023-01-02T00:00:00Z').toLocaleString());
  });

  it('returns unknown newVersion when no result and no remote value', async () => {
    await wrapper.setProps({
      container: createContainer({
        updateKind: undefined,
        result: undefined,
      }),
    });

    expect(wrapper.vm.newVersion).toBe('unknown');
  });

  it('computes update policy flags and labels for snoozed state', async () => {
    const snoozeUntil = new Date(Date.now() + 60_000).toISOString();
    await wrapper.setProps({
      container: createContainer({
        updatePolicy: {
          snoozeUntil,
          skipTags: ['other-tag'],
          skipDigests: ['other-digest'],
        },
      }),
    });

    expect(wrapper.vm.hasSnooze).toBe(true);
    expect(wrapper.vm.hasSkippedTags).toBe(true);
    expect(wrapper.vm.hasSkippedDigests).toBe(true);
    expect(wrapper.vm.hasAnyUpdatePolicy).toBe(true);
    expect(wrapper.vm.isSnoozed).toBe(true);
    expect(wrapper.vm.updatePolicyChipLabel).toBe('snoozed');
    expect(wrapper.vm.updatePolicyDescription).toBe(`Snoozed until ${snoozeUntil}`);
  });

  it('handles invalid snooze date and skipped tag policy state', async () => {
    await wrapper.setProps({
      container: createContainer({
        updateKind: {
          kind: 'tag',
          remoteValue: '1.1.0',
        },
        updatePolicy: {
          snoozeUntil: 'invalid-date',
          skipTags: ['1.1.0'],
        },
      }),
    });

    expect(wrapper.vm.isSnoozed).toBe(false);
    expect(wrapper.vm.isCurrentUpdateSkipped).toBe(true);
    expect(wrapper.vm.updatePolicyChipLabel).toBe('skipped');
    expect(wrapper.vm.updatePolicyDescription).toBe('Skipping tag update 1.1.0');
  });

  it('detects skipped digest policy state', async () => {
    await wrapper.setProps({
      container: createContainer({
        updateKind: {
          kind: 'digest',
          remoteValue: 'sha256:deadbeef',
        },
        updatePolicy: {
          skipDigests: ['sha256:deadbeef'],
        },
      }),
    });

    expect(wrapper.vm.isCurrentUpdateSkipped).toBe(true);
    expect(wrapper.vm.updatePolicyChipLabel).toBe('skipped');
  });

  it('does not mark current update skipped for unsupported update kind', async () => {
    await wrapper.setProps({
      container: createContainer({
        updateKind: {
          kind: 'unknown',
          remoteValue: 'latest',
        },
        updatePolicy: {
          skipTags: ['latest'],
          skipDigests: ['latest'],
        },
      }),
    });

    expect(wrapper.vm.isCurrentUpdateSkipped).toBe(false);
  });

  it('returns generic policy and no-policy descriptions when applicable', async () => {
    await wrapper.setProps({
      container: createContainer({
        updateKind: {
          kind: 'tag',
          remoteValue: '2.0.0',
        },
        updatePolicy: {
          skipTags: ['1.9.0'],
        },
      }),
    });

    expect(wrapper.vm.hasAnyUpdatePolicy).toBe(true);
    expect(wrapper.vm.isCurrentUpdateSkipped).toBe(false);
    expect(wrapper.vm.updatePolicyChipLabel).toBe('policy');
    expect(wrapper.vm.updatePolicyDescription).toBe('Custom update policy active');

    await wrapper.setProps({
      container: createContainer({
        updateKind: undefined,
        updatePolicy: undefined,
      }),
    });

    expect(wrapper.vm.hasAnyUpdatePolicy).toBe(false);
    expect(wrapper.vm.isCurrentUpdateSkipped).toBe(false);
    expect(wrapper.vm.updatePolicyChipLabel).toBe('');
    expect(wrapper.vm.updatePolicyDescription).toBe('No custom update policy');
  });

  it('applies update policy and emits success notification', async () => {
    const updated = createContainer({ id: 'policy-updated' });
    mockUpdateContainerPolicy.mockResolvedValueOnce(updated);

    await wrapper.vm.applyContainerUpdatePolicy('skip-current', { foo: 'bar' }, 'saved');

    expect(mockUpdateContainerPolicy).toHaveBeenCalledWith('test-container-id', 'skip-current', {
      foo: 'bar',
    });
    expect(wrapper.emitted('container-refreshed')?.at(-1)).toEqual([updated]);
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith('notify', 'saved');
  });

  it('handles update policy errors', async () => {
    mockUpdateContainerPolicy.mockRejectedValueOnce(new Error('policy failure'));

    await wrapper.vm.applyContainerUpdatePolicy('clear');

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Error when trying to update policy (policy failure)',
      'error',
    );
  });

  it('delegates skip/snooze/clear helpers to applyContainerUpdatePolicy', async () => {
    const applySpy = vi
      .spyOn(wrapper.vm, 'applyContainerUpdatePolicy')
      .mockResolvedValue(undefined);

    await wrapper.vm.skipCurrentUpdate();
    await wrapper.vm.snoozeUpdates(1);
    await wrapper.vm.snoozeUpdates(7);
    await wrapper.vm.clearSnooze();
    await wrapper.vm.clearUpdatePolicy();

    expect(applySpy).toHaveBeenCalledWith('skip-current', {}, 'Current update skipped');
    expect(applySpy).toHaveBeenCalledWith('snooze', { days: 1 }, 'Updates snoozed for 1 day');
    expect(applySpy).toHaveBeenCalledWith('snooze', { days: 7 }, 'Updates snoozed for 7 days');
    expect(applySpy).toHaveBeenCalledWith('unsnooze', {}, 'Snooze cleared');
    expect(applySpy).toHaveBeenCalledWith('clear', {}, 'Update policy cleared');
  });

  it('refreshes container and notifies by default', async () => {
    const refreshed = createContainer({ id: 'refreshed' });
    mockRefreshContainer.mockResolvedValueOnce(refreshed);

    await wrapper.vm.refreshContainerNow();

    expect(mockRefreshContainer).toHaveBeenCalledWith('test-container-id');
    expect(wrapper.emitted('container-refreshed')?.at(-1)).toEqual([refreshed]);
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith('notify', 'Container refreshed');
    expect(wrapper.vm.isRefreshingContainer).toBe(false);
  });

  it('refreshes container without success notify when disabled', async () => {
    const refreshed = createContainer({ id: 'refreshed-quiet' });
    mockRefreshContainer.mockResolvedValueOnce(refreshed);

    await wrapper.vm.refreshContainerNow(false);

    expect(wrapper.emitted('container-refreshed')?.at(-1)).toEqual([refreshed]);
    expect(wrapper.vm.$eventBus.emit).not.toHaveBeenCalledWith('notify', 'Container refreshed');
  });

  it('emits missing event when refreshed container is not found', async () => {
    mockRefreshContainer.mockResolvedValueOnce(undefined);

    await wrapper.vm.refreshContainerNow();

    expect(wrapper.emitted('container-missing')?.at(-1)).toEqual(['test-container-id']);
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Container no longer found in Docker',
      'warning',
    );
    expect(wrapper.vm.isRefreshingContainer).toBe(false);
  });

  it('handles refresh container errors', async () => {
    mockRefreshContainer.mockRejectedValueOnce(new Error('refresh failed'));

    await wrapper.vm.refreshContainerNow();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Error when trying to refresh container (refresh failed)',
      'error',
    );
    expect(wrapper.vm.isRefreshingContainer).toBe(false);
  });

  it('warns when no triggers are configured for update now', async () => {
    mockGetContainerTriggers.mockResolvedValueOnce([]);

    await wrapper.vm.updateContainerNow();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'No triggers associated to this container',
      'warning',
    );
    expect(wrapper.vm.isUpdatingContainer).toBe(false);
  });

  it('runs triggers and refreshes container after successful update', async () => {
    mockGetContainerTriggers.mockResolvedValueOnce([
      { type: 'slack', name: 'primary', agent: 'node1' },
      { type: 'smtp', name: 'fallback', agent: 'node2' },
    ]);
    mockRunTrigger.mockResolvedValue({});
    const refreshSpy = vi.spyOn(wrapper.vm, 'refreshContainerNow').mockResolvedValue(undefined);

    await wrapper.vm.updateContainerNow();

    expect(mockRunTrigger).toHaveBeenCalledTimes(2);
    expect(mockRunTrigger).toHaveBeenCalledWith({
      containerId: 'test-container-id',
      triggerType: 'slack',
      triggerName: 'primary',
      triggerAgent: 'node1',
    });
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Update triggered (2 triggers)',
    );
    expect(refreshSpy).toHaveBeenCalledWith(false);
    expect(wrapper.vm.isUpdatingContainer).toBe(false);
  });

  it('reports trigger failures while updating container', async () => {
    mockGetContainerTriggers.mockResolvedValueOnce([
      { type: 'slack', name: 'primary', agent: 'node1' },
    ]);
    mockRunTrigger.mockResolvedValueOnce({ error: 'failed' });

    await wrapper.vm.updateContainerNow();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Error when trying to update container (some triggers failed (slack.primary))',
      'error',
    );
    expect(wrapper.vm.isUpdatingContainer).toBe(false);
  });

  it('handles trigger retrieval errors while updating container', async () => {
    mockGetContainerTriggers.mockRejectedValueOnce(new Error('trigger lookup failed'));

    await wrapper.vm.updateContainerNow();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Error when trying to update container (trigger lookup failed)',
      'error',
    );
    expect(wrapper.vm.isUpdatingContainer).toBe(false);
  });

  it('notifies on rollback success and refreshes container', async () => {
    const refreshSpy = vi.spyOn(wrapper.vm, 'refreshContainerNow').mockResolvedValue(undefined);

    await wrapper.vm.onRollbackSuccess();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Container rolled back successfully',
    );
    expect(refreshSpy).toHaveBeenCalledWith(false);
  });

  it('starts container and emits refreshed event when container is returned', async () => {
    const started = createContainer({ id: 'started' });
    mockStartContainer.mockResolvedValueOnce({ container: started });

    await wrapper.vm.startContainerAction();

    expect(mockStartContainer).toHaveBeenCalledWith('test-container-id');
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith('notify', 'Container started');
    expect(wrapper.emitted('container-refreshed')?.at(-1)).toEqual([started]);
    expect(wrapper.vm.isStarting).toBe(false);
  });

  it('starts container without refreshed emit when payload has no container', async () => {
    mockStartContainer.mockResolvedValueOnce({});

    await wrapper.vm.startContainerAction();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith('notify', 'Container started');
    expect(wrapper.vm.isStarting).toBe(false);
  });

  it('handles start container errors', async () => {
    mockStartContainer.mockRejectedValueOnce(new Error('start failed'));

    await wrapper.vm.startContainerAction();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Error starting container (start failed)',
      'error',
    );
    expect(wrapper.vm.isStarting).toBe(false);
  });

  it('stops container and emits refreshed event when container is returned', async () => {
    const stopped = createContainer({ id: 'stopped' });
    mockStopContainer.mockResolvedValueOnce({ container: stopped });

    await wrapper.vm.stopContainerAction();

    expect(mockStopContainer).toHaveBeenCalledWith('test-container-id');
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith('notify', 'Container stopped');
    expect(wrapper.emitted('container-refreshed')?.at(-1)).toEqual([stopped]);
    expect(wrapper.vm.isStopping).toBe(false);
  });

  it('stops container without refreshed emit when payload has no container', async () => {
    mockStopContainer.mockResolvedValueOnce({});

    await wrapper.vm.stopContainerAction();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith('notify', 'Container stopped');
    expect(wrapper.vm.isStopping).toBe(false);
  });

  it('handles stop container errors', async () => {
    mockStopContainer.mockRejectedValueOnce(new Error('stop failed'));

    await wrapper.vm.stopContainerAction();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Error stopping container (stop failed)',
      'error',
    );
    expect(wrapper.vm.isStopping).toBe(false);
  });

  it('restarts container and emits refreshed event when container is returned', async () => {
    const restarted = createContainer({ id: 'restarted' });
    mockRestartContainer.mockResolvedValueOnce({ container: restarted });

    await wrapper.vm.restartContainerAction();

    expect(mockRestartContainer).toHaveBeenCalledWith('test-container-id');
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith('notify', 'Container restarted');
    expect(wrapper.emitted('container-refreshed')?.at(-1)).toEqual([restarted]);
    expect(wrapper.vm.isRestarting).toBe(false);
  });

  it('restarts container without refreshed emit when payload has no container', async () => {
    mockRestartContainer.mockResolvedValueOnce({});

    await wrapper.vm.restartContainerAction();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith('notify', 'Container restarted');
    expect(wrapper.vm.isRestarting).toBe(false);
  });

  it('handles restart container errors', async () => {
    mockRestartContainer.mockRejectedValueOnce(new Error('restart failed'));

    await wrapper.vm.restartContainerAction();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Error restarting container (restart failed)',
      'error',
    );
    expect(wrapper.vm.isRestarting).toBe(false);
  });

  it('copies values to clipboard and notifies', () => {
    wrapper.vm.copyToClipboard('container id', 'abc123');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc123');
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'container id copied to clipboard',
    );
  });

  it('collapses detail when no text selection and resizes tabs', () => {
    const selectionSpy = vi
      .spyOn(globalThis, 'getSelection')
      .mockReturnValue({ type: 'None' } as any);
    const onResize = vi.fn();
    const collapseDetail = (wrapper.vm.$options as any).methods.collapseDetail;
    const context = {
      showDetail: false,
      $refs: {
        tabs: { onResize },
      },
    };

    collapseDetail.call(context);

    expect(context.showDetail).toBe(true);
    expect(onResize).toHaveBeenCalled();
    selectionSpy.mockRestore();
  });

  it('does not collapse when selecting text', () => {
    const selectionSpy = vi
      .spyOn(globalThis, 'getSelection')
      .mockReturnValue({ type: 'Range' } as any);
    const onResize = vi.fn();
    const collapseDetail = (wrapper.vm.$options as any).methods.collapseDetail;
    const context = {
      showDetail: false,
      $refs: {
        tabs: { onResize },
      },
    };

    collapseDetail.call(context);

    expect(context.showDetail).toBe(false);
    expect(onResize).toHaveBeenCalled();
    selectionSpy.mockRestore();
  });

  it('normalizes fontawesome icon strings', () => {
    expect(wrapper.vm.normalizeFontawesome('fab:docker', 'fab')).toBe('fab fa-docker');
  });

  it('applies server feature flags on mount', () => {
    expect(wrapper.vm.deleteEnabled).toBe(true);
    expect(wrapper.vm.containerActionsEnabled).toBe(true);
  });

  it('respects explicit server feature flag values', () => {
    const localWrapper = mountComponent(
      {
        container: createContainer(),
      },
      {
        global: {
          mocks: {
            $serverConfig: {
              feature: {
                delete: false,
                containeractions: false,
              },
            },
          },
        },
      },
    );

    try {
      expect(localWrapper.vm.deleteEnabled).toBe(false);
      expect(localWrapper.vm.containerActionsEnabled).toBe(false);
    } finally {
      localWrapper.unmount();
    }
  });
});
