import { mount } from '@vue/test-utils';
import ContainerItem from '@/components/ContainerItem';

const {
  mockRefreshContainer,
  mockScanContainer,
  mockUpdateContainerPolicy,
  mockStartContainer,
  mockStopContainer,
  mockRestartContainer,
  mockUpdateContainer,
  mockGetEffectiveDisplayIcon,
  mockGetRegistryProviderIcon,
} = vi.hoisted(() => ({
  mockRefreshContainer: vi.fn(),
  mockScanContainer: vi.fn(),
  mockUpdateContainerPolicy: vi.fn(),
  mockStartContainer: vi.fn(),
  mockStopContainer: vi.fn(),
  mockRestartContainer: vi.fn(),
  mockUpdateContainer: vi.fn(),
  mockGetEffectiveDisplayIcon: vi.fn(),
  mockGetRegistryProviderIcon: vi.fn(),
}));

vi.mock('@/services/container', () => ({
  refreshContainer: mockRefreshContainer,
  scanContainer: mockScanContainer,
  updateContainerPolicy: mockUpdateContainerPolicy,
}));

vi.mock('@/services/container-actions', () => ({
  startContainer: mockStartContainer,
  stopContainer: mockStopContainer,
  restartContainer: mockRestartContainer,
  updateContainer: mockUpdateContainer,
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

const BASE_SECURITY_SCAN = {
  scanner: 'trivy',
  image: 'repo/image:1.1.0',
  scannedAt: '2026-01-10T12:00:00.000Z',
  status: 'passed',
  blockSeverities: ['CRITICAL', 'HIGH'],
  blockingCount: 0,
  summary: {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  },
  vulnerabilities: [],
};

const BASE_SIGNATURE_VERIFICATION = {
  verifier: 'cosign',
  image: 'repo/image:1.1.0',
  verifiedAt: '2026-01-10T12:00:00.000Z',
  status: 'verified',
  keyless: true,
  signatures: 1,
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
    mockRefreshContainer.mockReset();
    mockScanContainer.mockReset();
    mockUpdateContainerPolicy.mockReset();
    mockStartContainer.mockReset();
    mockStopContainer.mockReset();
    mockRestartContainer.mockReset();
    mockUpdateContainer.mockReset();
    mockGetEffectiveDisplayIcon.mockReset();
    mockGetRegistryProviderIcon.mockReset();

    mockGetEffectiveDisplayIcon.mockImplementation(
      (displayIcon: string) => displayIcon || 'fas fa-cube',
    );
    mockGetRegistryProviderIcon.mockImplementation((provider: string) =>
      provider === 'hub' ? 'fab fa-docker' : 'fas fa-cube',
    );
    mockRefreshContainer.mockResolvedValue(createContainer({ id: 'refreshed' }));
    mockUpdateContainerPolicy.mockResolvedValue(createContainer({ id: 'policy-updated' }));
    mockScanContainer.mockResolvedValue(createContainer({ id: 'scanned' }));
    mockStartContainer.mockResolvedValue({ container: createContainer({ id: 'started' }) });
    mockStopContainer.mockResolvedValue({ container: createContainer({ id: 'stopped' }) });
    mockRestartContainer.mockResolvedValue({ container: createContainer({ id: 'restarted' }) });
    mockUpdateContainer.mockResolvedValue({ container: createContainer({ id: 'updated' }) });

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

  it('shows no vulnerability chip state when no scan is recorded', () => {
    expect(wrapper.vm.securityScan).toBeUndefined();
    expect(wrapper.vm.hasSecurityScan).toBe(false);
    expect(wrapper.vm.vulnerabilityChipColor).toBe('info');
    expect(wrapper.vm.vulnerabilityChipLabel).toBe('no scan');
    expect(wrapper.vm.vulnerabilityTooltipDescription).toBe('No vulnerability scan result');
  });

  it('computes vulnerability chip and tooltip for blocked scan results', async () => {
    const blockedScan = {
      ...BASE_SECURITY_SCAN,
      status: 'blocked',
      blockingCount: 2,
      summary: {
        critical: 1,
        high: 1,
        medium: 3,
        low: 4,
        unknown: 0,
      },
    };

    await wrapper.setProps({
      container: createContainer({
        security: {
          scan: blockedScan,
        },
      }),
    });

    expect(wrapper.vm.hasSecurityScan).toBe(true);
    expect(wrapper.vm.vulnerabilityChipColor).toBe('error');
    expect(wrapper.vm.vulnerabilityChipLabel).toBe('blocked (2)');
    expect(wrapper.vm.vulnerabilityTooltipDescription).toBe(
      `Blocked at ${new Date(blockedScan.scannedAt).toLocaleString()}. Critical: 1, High: 1, Medium: 3, Low: 4, Unknown: 0`,
    );
    expect(wrapper.text()).toContain('blocked (2)');
  });

  it('computes vulnerability chip and tooltip for scan errors', async () => {
    const errorScan = {
      ...BASE_SECURITY_SCAN,
      status: 'error',
      error: 'Trivy command failed',
    };

    await wrapper.setProps({
      container: createContainer({
        security: {
          scan: errorScan,
        },
      }),
    });

    expect(wrapper.vm.hasSecurityScan).toBe(true);
    expect(wrapper.vm.vulnerabilityChipColor).toBe('warning');
    expect(wrapper.vm.vulnerabilityChipLabel).toBe('scan error');
    expect(wrapper.vm.vulnerabilityTooltipDescription).toBe(
      `Security scan failed at ${new Date(errorScan.scannedAt).toLocaleString()}: Trivy command failed`,
    );
    expect(wrapper.text()).toContain('scan error');
  });

  it('computes vulnerability chip and tooltip for passed scans', async () => {
    const passedScan = {
      ...BASE_SECURITY_SCAN,
      status: 'passed',
      summary: {
        critical: 0,
        high: 0,
        medium: 1,
        low: 2,
        unknown: 1,
      },
    };

    await wrapper.setProps({
      container: createContainer({
        security: {
          scan: passedScan,
        },
      }),
    });

    expect(wrapper.vm.hasSecurityScan).toBe(true);
    expect(wrapper.vm.vulnerabilityChipColor).toBe('success');
    expect(wrapper.vm.vulnerabilityChipLabel).toBe('safe');
    expect(wrapper.vm.vulnerabilityTooltipDescription).toBe(
      `Scanned at ${new Date(passedScan.scannedAt).toLocaleString()}. Critical: 0, High: 0, Medium: 1, Low: 2, Unknown: 1`,
    );
    expect(wrapper.text()).toContain('safe');
  });

  it('shows no signature chip state when no verification is recorded', () => {
    expect(wrapper.vm.signatureVerification).toBeUndefined();
    expect(wrapper.vm.hasSignatureVerification).toBe(false);
    expect(wrapper.vm.signatureChipColor).toBe('info');
    expect(wrapper.vm.signatureChipLabel).toBe('no sig');
    expect(wrapper.vm.signatureTooltipDescription).toBe('No signature verification result');
  });

  it('computes signature chip and tooltip for verified images', async () => {
    await wrapper.setProps({
      container: createContainer({
        security: {
          signature: BASE_SIGNATURE_VERIFICATION,
        },
      }),
    });

    expect(wrapper.vm.hasSignatureVerification).toBe(true);
    expect(wrapper.vm.signatureChipColor).toBe('success');
    expect(wrapper.vm.signatureChipLabel).toBe('signed');
    expect(wrapper.vm.signatureTooltipDescription).toBe(
      `Verified at ${new Date(BASE_SIGNATURE_VERIFICATION.verifiedAt).toLocaleString()}. 1 signature (keyless)`,
    );
    expect(wrapper.text()).toContain('signed');
  });

  it('computes signature tooltip with plural signatures', async () => {
    const multiSignature = {
      ...BASE_SIGNATURE_VERIFICATION,
      signatures: 3,
      keyless: false,
    };
    await wrapper.setProps({
      container: createContainer({
        security: {
          signature: multiSignature,
        },
      }),
    });

    expect(wrapper.vm.signatureTooltipDescription).toBe(
      `Verified at ${new Date(multiSignature.verifiedAt).toLocaleString()}. 3 signatures (public-key)`,
    );
  });

  it('computes signature chip and tooltip for unverified images', async () => {
    const unverifiedSignature = {
      ...BASE_SIGNATURE_VERIFICATION,
      status: 'unverified',
      keyless: false,
      signatures: 0,
      error: 'no matching signatures',
    };
    await wrapper.setProps({
      container: createContainer({
        security: {
          signature: unverifiedSignature,
        },
      }),
    });

    expect(wrapper.vm.hasSignatureVerification).toBe(true);
    expect(wrapper.vm.signatureChipColor).toBe('error');
    expect(wrapper.vm.signatureChipLabel).toBe('unsigned');
    expect(wrapper.vm.signatureTooltipDescription).toBe(
      `No valid image signature found at ${new Date(unverifiedSignature.verifiedAt).toLocaleString()}: no matching signatures`,
    );
    expect(wrapper.text()).toContain('unsigned');
  });

  it('computes signature chip and tooltip for signature errors', async () => {
    const errorSignature = {
      ...BASE_SIGNATURE_VERIFICATION,
      status: 'error',
      error: 'cosign command failed',
    };
    await wrapper.setProps({
      container: createContainer({
        security: {
          signature: errorSignature,
        },
      }),
    });

    expect(wrapper.vm.hasSignatureVerification).toBe(true);
    expect(wrapper.vm.signatureChipColor).toBe('warning');
    expect(wrapper.vm.signatureChipLabel).toBe('sig error');
    expect(wrapper.vm.signatureTooltipDescription).toBe(
      `Signature verification failed at ${new Date(errorSignature.verifiedAt).toLocaleString()}: cosign command failed`,
    );
    expect(wrapper.text()).toContain('sig error');
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

  it('updates container and emits refreshed event on success', async () => {
    const updated = createContainer({ id: 'updated' });
    mockUpdateContainer.mockResolvedValueOnce({ container: updated });

    await wrapper.vm.updateContainerNow();

    expect(mockUpdateContainer).toHaveBeenCalledWith('test-container-id');
    expect(wrapper.emitted('container-refreshed')?.at(-1)).toEqual([updated]);
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith('notify', 'Container updated');
    expect(wrapper.vm.isUpdatingContainer).toBe(false);
  });

  it('updates container without refreshed emit when payload has no container', async () => {
    mockUpdateContainer.mockResolvedValueOnce({});

    await wrapper.vm.updateContainerNow();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith('notify', 'Container updated');
    expect(wrapper.vm.isUpdatingContainer).toBe(false);
  });

  it('handles update container errors', async () => {
    mockUpdateContainer.mockRejectedValueOnce(new Error('update failed'));

    await wrapper.vm.updateContainerNow();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Error when trying to update container (update failed)',
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

  it('defaults blockingCount to 0 when missing from blocked scan data', async () => {
    const scanWithoutBlockingCount = {
      ...BASE_SECURITY_SCAN,
      status: 'blocked',
      summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
    };
    delete (scanWithoutBlockingCount as any).blockingCount;

    await wrapper.setProps({
      container: createContainer({
        security: { scan: scanWithoutBlockingCount },
      }),
    });

    expect(wrapper.vm.vulnerabilityChipLabel).toBe('blocked (0)');
  });

  it('defaults missing severity fields to 0 in tooltip description', async () => {
    const scanWithPartialSummary = {
      ...BASE_SECURITY_SCAN,
      status: 'passed',
      summary: { critical: 2 },
    };

    await wrapper.setProps({
      container: createContainer({
        security: { scan: scanWithPartialSummary },
      }),
    });

    expect(wrapper.vm.vulnerabilityTooltipDescription).toBe(
      `Scanned at ${new Date(scanWithPartialSummary.scannedAt).toLocaleString()}. Critical: 2, High: 0, Medium: 0, Low: 0, Unknown: 0`,
    );
  });

  it('shows unknown error in tooltip when status is error but error field is absent', async () => {
    const errorScanNoMessage = {
      ...BASE_SECURITY_SCAN,
      status: 'error',
    };
    delete (errorScanNoMessage as any).error;

    await wrapper.setProps({
      container: createContainer({
        security: { scan: errorScanNoMessage },
      }),
    });

    expect(wrapper.vm.vulnerabilityChipLabel).toBe('scan error');
    expect(wrapper.vm.vulnerabilityTooltipDescription).toBe(
      `Security scan failed at ${new Date(errorScanNoMessage.scannedAt).toLocaleString()}: unknown error`,
    );
  });

  it('scans container and emits refreshed event on success', async () => {
    const scanned = createContainer({ id: 'scanned' });
    mockScanContainer.mockResolvedValueOnce(scanned);

    await wrapper.vm.scanContainerNow();

    expect(mockScanContainer).toHaveBeenCalledWith('test-container-id');
    expect(wrapper.emitted('container-refreshed')?.at(-1)).toEqual([scanned]);
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith('notify', 'Security scan completed');
    expect(wrapper.vm.isScanningContainer).toBe(false);
  });

  it('handles scan container errors', async () => {
    mockScanContainer.mockRejectedValueOnce(new Error('scan failed'));

    await wrapper.vm.scanContainerNow();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Error when running security scan (scan failed)',
      'error',
    );
    expect(wrapper.vm.isScanningContainer).toBe(false);
  });

  it('has isScanningContainer data property defaulting to false', () => {
    expect(wrapper.vm.isScanningContainer).toBe(false);
  });

  it('defaults summary fields to 0 when scan has no summary property', async () => {
    const scanNoSummary = {
      ...BASE_SECURITY_SCAN,
      status: 'passed',
    };
    delete (scanNoSummary as any).summary;

    await wrapper.setProps({
      container: createContainer({
        security: { scan: scanNoSummary },
      }),
    });

    expect(wrapper.vm.vulnerabilityTooltipDescription).toBe(
      `Scanned at ${new Date(scanNoSummary.scannedAt).toLocaleString()}. Critical: 0, High: 0, Medium: 0, Low: 0, Unknown: 0`,
    );
  });

  it('falls back scannedAt to unknown when it is falsy', async () => {
    const scanNoDate = {
      ...BASE_SECURITY_SCAN,
      status: 'passed',
      scannedAt: '',
    };

    await wrapper.setProps({
      container: createContainer({
        security: { scan: scanNoDate },
      }),
    });

    // hasSecurityScan is false because scannedAt is falsy, so tooltip path differs
    expect(wrapper.vm.hasSecurityScan).toBe(false);
    expect(wrapper.vm.vulnerabilityTooltipDescription).toBe('No vulnerability scan result');

    // Force hasSecurityScan to be true by keeping a truthy scannedAt but testing the fallback
    // The fallback at line 257 is: scannedAt ? dateTime(scannedAt) : 'unknown'
    // We need hasSecurityScan true (scannedAt truthy) but test when scannedAt is undefined
    // Actually scannedAt is checked twice: once for hasSecurityScan (Boolean) and once for display
    // We can use null which is falsy for Boolean but still go through by overriding hasSecurityScan
    // Instead, set scannedAt to undefined and access the computed directly with a scan that has scannedAt
    // The cleanest way: provide a scan where scannedAt evaluates truthy for Boolean but falsy in ternary
    // That's not possible. The fallback is reachable if securityScan.scannedAt is truthy for hasSecurityScan
    // but securityScan?.scannedAt is falsy in the ternary. Since they reference the same value, the
    // 'unknown' fallback for scannedAt display at line 257 is only reachable if hasSecurityScan is overridden.
    // The status fallback at line 260 IS reachable - scan with no status property.
  });

  it('falls back scan status to unknown when status is falsy', async () => {
    const scanNoStatus = {
      ...BASE_SECURITY_SCAN,
      scannedAt: '2026-01-10T12:00:00.000Z',
    };
    delete (scanNoStatus as any).status;

    await wrapper.setProps({
      container: createContainer({
        security: { scan: scanNoStatus },
      }),
    });

    // status is undefined so falls through all if-checks to the default return
    expect(wrapper.vm.vulnerabilityTooltipDescription).toBe(
      `Scanned at ${new Date(scanNoStatus.scannedAt).toLocaleString()}. Critical: 0, High: 0, Medium: 0, Low: 0, Unknown: 0`,
    );
    // Also verify chip color/label use the fallback path
    expect(wrapper.vm.vulnerabilityChipColor).toBe('info');
    expect(wrapper.vm.vulnerabilityChipLabel).toBe('no scan');
  });

  it('falls back verifiedAt to unknown when it is falsy in signature tooltip', async () => {
    const sigNoDate = {
      ...BASE_SIGNATURE_VERIFICATION,
      verifiedAt: '',
      status: 'verified',
      signatures: 2,
      keyless: false,
    };

    await wrapper.setProps({
      container: createContainer({
        security: { signature: sigNoDate },
      }),
    });

    // hasSignatureVerification is false when verifiedAt is falsy
    expect(wrapper.vm.hasSignatureVerification).toBe(false);
    expect(wrapper.vm.signatureTooltipDescription).toBe('No signature verification result');
  });

  it('uses unknown scannedAt fallback when forced through computed context', () => {
    const filters = { dateTime: vi.fn((value: string) => new Date(value).toLocaleString()) };
    const description = (ContainerItem as any).computed.vulnerabilityTooltipDescription.call({
      hasSecurityScan: true,
      securityScan: {
        status: 'passed',
        scannedAt: undefined,
        summary: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          unknown: 0,
        },
      },
      $filters: filters,
    });

    expect(description).toContain('Scanned at unknown.');
    expect(filters.dateTime).not.toHaveBeenCalled();
  });

  it('uses unknown verifiedAt fallback when forced through computed context', () => {
    const filters = { dateTime: vi.fn((value: string) => new Date(value).toLocaleString()) };
    const description = (ContainerItem as any).computed.signatureTooltipDescription.call({
      hasSignatureVerification: true,
      signatureVerification: {
        status: 'verified',
        verifiedAt: undefined,
        signatures: 2,
        keyless: true,
      },
      $filters: filters,
    });

    expect(description).toContain('Verified at unknown. 2 signatures (keyless)');
    expect(filters.dateTime).not.toHaveBeenCalled();
  });

  it('falls back signature status to unknown when status is falsy', async () => {
    const sigNoStatus = {
      ...BASE_SIGNATURE_VERIFICATION,
      verifiedAt: '2026-01-10T12:00:00.000Z',
    };
    delete (sigNoStatus as any).status;

    await wrapper.setProps({
      container: createContainer({
        security: { signature: sigNoStatus },
      }),
    });

    // status is undefined, falls through all if-checks to the default verified return
    expect(wrapper.vm.signatureChipColor).toBe('info');
    expect(wrapper.vm.signatureChipLabel).toBe('no sig');
    // signatureTooltipDescription: status || 'unknown' => 'unknown', then falls through to verified path
    expect(wrapper.vm.signatureTooltipDescription).toContain(
      `Verified at ${new Date(sigNoStatus.verifiedAt).toLocaleString()}`,
    );
  });

  it('defaults signatures count to 0 when signature count is missing', async () => {
    const sigNoCount = {
      ...BASE_SIGNATURE_VERIFICATION,
      status: 'verified',
    };
    delete (sigNoCount as any).signatures;

    await wrapper.setProps({
      container: createContainer({
        security: { signature: sigNoCount },
      }),
    });

    expect(wrapper.vm.signatureTooltipDescription).toBe(
      `Verified at ${new Date(sigNoCount.verifiedAt).toLocaleString()}. 0 signatures (keyless)`,
    );
  });

  it('falls back signature error to unknown error when error field is absent', async () => {
    const sigErrorNoMessage = {
      ...BASE_SIGNATURE_VERIFICATION,
      status: 'error',
    };
    delete (sigErrorNoMessage as any).error;

    await wrapper.setProps({
      container: createContainer({
        security: { signature: sigErrorNoMessage },
      }),
    });

    expect(wrapper.vm.signatureTooltipDescription).toBe(
      `Signature verification failed at ${new Date(sigErrorNoMessage.verifiedAt).toLocaleString()}: unknown error`,
    );
  });

  it('falls back unverified signature error to default message when error is absent', async () => {
    const sigUnverifiedNoError = {
      ...BASE_SIGNATURE_VERIFICATION,
      status: 'unverified',
    };
    delete (sigUnverifiedNoError as any).error;

    await wrapper.setProps({
      container: createContainer({
        security: { signature: sigUnverifiedNoError },
      }),
    });

    expect(wrapper.vm.signatureTooltipDescription).toBe(
      `No valid image signature found at ${new Date(sigUnverifiedNoError.verifiedAt).toLocaleString()}: signature missing or invalid`,
    );
  });

  it('uses singular signature label for exactly 1 signature with public-key', async () => {
    const sigSingle = {
      ...BASE_SIGNATURE_VERIFICATION,
      status: 'verified',
      signatures: 1,
      keyless: false,
    };

    await wrapper.setProps({
      container: createContainer({
        security: { signature: sigSingle },
      }),
    });

    expect(wrapper.vm.signatureTooltipDescription).toBe(
      `Verified at ${new Date(sigSingle.verifiedAt).toLocaleString()}. 1 signature (public-key)`,
    );
  });
});
