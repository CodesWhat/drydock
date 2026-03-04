import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import ContainerSideTabContent from '@/components/containers/ContainerSideTabContent.vue';

const selectedContainer = ref({
  id: 'container-1',
  name: 'nginx',
  image: 'nginx',
  currentTag: 'latest',
  status: 'running',
  server: 'local',
  newTag: undefined,
  details: {
    ports: [],
    volumes: [],
    env: [
      { key: 'PATH', value: '/usr/local/bin:/usr/bin', sensitive: false },
      { key: 'DB_PASSWORD', value: 'super-secret', sensitive: true },
      { key: 'NODE_ENV', value: 'production', sensitive: false },
    ],
    labels: [],
  },
});
const activeDetailTab = ref('environment');

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => ({
    selectedContainer,
    activeDetailTab,
    selectedRuntimeOrigins: ref([]),
    runtimeOriginStyle: () => ({}),
    runtimeOriginLabel: () => '',
    selectedRuntimeDriftWarnings: ref([]),
    selectedLifecycleHooks: ref([]),
    lifecycleHookTemplateVariables: ref([]),
    selectedAutoRollbackConfig: ref(null),
    selectedImageMetadata: ref(null),
    formatTimestamp: (v: string) => v,
    detailVulnerabilityLoading: ref(false),
    detailSbomLoading: ref(false),
    loadDetailSecurityData: vi.fn(),
    detailVulnerabilityError: ref(null),
    vulnerabilitySummary: ref(null),
    vulnerabilityTotal: ref(0),
    vulnerabilityPreview: ref([]),
    severityStyle: () => ({}),
    normalizeSeverity: (s: string) => s,
    getVulnerabilityPackage: () => '',
    selectedSbomFormat: ref('json'),
    loadDetailSbom: vi.fn(),
    detailSbomError: ref(null),
    sbomDocument: ref(null),
    sbomComponentCount: ref(0),
    sbomGeneratedAt: ref(null),
    LOG_AUTO_FETCH_INTERVALS: [5, 15, 30],
    containerAutoFetchInterval: ref(15),
    getContainerLogs: vi.fn(),
    containerLogRef: ref(null),
    containerHandleLogScroll: vi.fn(),
    containerScrollBlocked: ref(false),
    containerResumeAutoScroll: vi.fn(),
    previewLoading: ref(false),
    runContainerPreview: vi.fn(),
    actionInProgress: ref(false),
    policyInProgress: ref(false),
    skipCurrentForSelected: vi.fn(),
    snoozeSelected: vi.fn(),
    snoozeDateInput: ref(''),
    snoozeSelectedUntilDate: vi.fn(),
    selectedSnoozeUntil: ref(null),
    unsnoozeSelected: vi.fn(),
    selectedSkipTags: ref([]),
    selectedSkipDigests: ref([]),
    clearSkipsSelected: vi.fn(),
    selectedUpdatePolicy: ref(null),
    clearPolicySelected: vi.fn(),
    policyMessage: ref(null),
    policyError: ref(null),
    removeSkipTagSelected: vi.fn(),
    removeSkipDigestSelected: vi.fn(),
    detailPreview: ref(null),
    previewError: ref(null),
    triggersLoading: ref(false),
    detailTriggers: ref([]),
    getTriggerKey: () => '',
    triggerRunInProgress: ref({}),
    runAssociatedTrigger: vi.fn(),
    triggerMessage: ref(null),
    triggerError: ref(null),
    backupsLoading: ref(false),
    detailBackups: ref([]),
    rollbackInProgress: ref(false),
    rollbackToBackup: vi.fn(),
    rollbackMessage: ref(null),
    rollbackError: ref(null),
    updateOperationsLoading: ref(false),
    detailUpdateOperations: ref([]),
    getOperationStatusStyle: () => ({}),
    formatOperationStatus: () => '',
    formatOperationPhase: () => '',
    formatRollbackReason: () => '',
    updateOperationsError: ref(null),
    scanContainer: vi.fn(),
    updateContainer: vi.fn(),
    registryColorBg: ref(''),
    registryColorText: ref(''),
    registryLabel: ref(''),
  }),
}));

function mountComponent() {
  return mount(ContainerSideTabContent, {
    global: {
      stubs: {
        AppIcon: { template: '<span class="app-icon-stub" />', props: ['name', 'size'] },
      },
      directives: {
        tooltip: {},
      },
    },
  });
}

describe('ContainerSideTabContent - Environment Variables', () => {
  afterEach(() => {
    activeDetailTab.value = 'environment';
    selectedContainer.value = {
      id: 'container-1',
      name: 'nginx',
      image: 'nginx',
      currentTag: 'latest',
      status: 'running',
      server: 'local',
      newTag: undefined,
      details: {
        ports: [],
        volumes: [],
        env: [
          { key: 'PATH', value: '/usr/local/bin:/usr/bin', sensitive: false },
          { key: 'DB_PASSWORD', value: 'super-secret', sensitive: true },
          { key: 'NODE_ENV', value: 'production', sensitive: false },
        ],
        labels: [],
      },
    };
  });

  it('displays non-sensitive env var values directly', () => {
    const wrapper = mountComponent();
    const envRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const pathRow = envRows.find((row) => row.text().includes('PATH'));
    expect(pathRow).toBeDefined();
    expect(pathRow?.text()).toContain('/usr/local/bin:/usr/bin');
  });

  it('masks sensitive env var values with dots', () => {
    const wrapper = mountComponent();
    const envRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const passwordRow = envRows.find((row) => row.text().includes('DB_PASSWORD'));
    expect(passwordRow).toBeDefined();
    expect(passwordRow?.text()).not.toContain('super-secret');
    expect(passwordRow?.text()).toContain('\u2022\u2022\u2022\u2022\u2022');
  });

  it('reveals sensitive value on eye button click', async () => {
    const wrapper = mountComponent();
    const envRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const passwordRow = envRows.find((row) => row.text().includes('DB_PASSWORD'));
    expect(passwordRow).toBeDefined();

    const eyeButton = passwordRow?.find('button');
    expect(eyeButton).toBeDefined();

    await eyeButton?.trigger('click');
    await nextTick();

    const updatedRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const updatedPasswordRow = updatedRows.find((row) => row.text().includes('DB_PASSWORD'));
    expect(updatedPasswordRow?.text()).toContain('super-secret');
  });

  it('re-masks sensitive value on second eye button click', async () => {
    const wrapper = mountComponent();
    const envRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const passwordRow = envRows.find((row) => row.text().includes('DB_PASSWORD'));

    const eyeButton = passwordRow?.find('button');

    // Reveal
    await eyeButton?.trigger('click');
    await nextTick();

    // Re-mask
    await eyeButton?.trigger('click');
    await nextTick();

    const updatedRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const updatedPasswordRow = updatedRows.find((row) => row.text().includes('DB_PASSWORD'));
    expect(updatedPasswordRow?.text()).not.toContain('super-secret');
    expect(updatedPasswordRow?.text()).toContain('\u2022\u2022\u2022\u2022\u2022');
  });
});
