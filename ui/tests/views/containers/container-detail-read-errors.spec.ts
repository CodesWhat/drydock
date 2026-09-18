import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { i18n } from '@/boot/i18n';
import { useContainerBackups } from '@/views/containers/useContainerBackups';
import { useContainerTriggers } from '@/views/containers/useContainerTriggers';

const originalLocale = i18n.global.locale.value;
let wrapper: VueWrapper | undefined;
const selectedId = ref<string | undefined>('c1');
const triggerPayload = {
  data: [{ type: 'http', name: 'alerts' }],
  unassociatedTriggers: [
    { id: 'docker.deploy', type: 'docker', name: 'deploy', reason: 'agentOwnership' },
  ],
};

function mountReaders() {
  let triggers!: ReturnType<typeof useContainerTriggers>;
  let backups!: ReturnType<typeof useContainerBackups>;
  wrapper = mount(
    defineComponent({
      setup() {
        const common = {
          selectedContainerId: selectedId,
          containerActionsEnabled: ref(true),
          containerActionsDisabledReason: ref(''),
          loadContainers: vi.fn(),
        };
        triggers = useContainerTriggers({ ...common, refreshActionTabData: vi.fn() });
        backups = useContainerBackups({
          ...common,
          selectedContainerKey: ref('local/c1'),
          skippedUpdates: ref(new Set<string>()),
        });
        return {};
      },
      template: '<div />',
    }),
  );
  return { triggers, backups };
}

beforeEach(() => {
  selectedId.value = 'c1';
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(['fr', 'ar'] as const)('container detail reads in %s', (locale) => {
  it('shows trigger failure and explicitly reloads both associated and unavailable entries', async () => {
    i18n.global.locale.value = locale;
    const { triggers } = mountReaders();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await triggers.loadDetailTriggers();
    expect(triggers.triggerError.value).toBe(
      `${i18n.global.t('containerComponents.triggers.toasts.loadFailed')} (c1) (HTTP 503)`,
    );
    expect(triggers.triggersLoading.value).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(triggerPayload));
    await triggers.loadDetailTriggers();
    expect(triggers.triggerError.value).toBeNull();
    expect(triggers.detailTriggers.value).toEqual(triggerPayload.data);
    expect(triggers.unassociatedTriggers.value).toEqual(triggerPayload.unassociatedTriggers);
    expect(selectedId.value).toBe('c1');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
  });

  it('shows update-history failure and explicitly reloads without a rollback', async () => {
    i18n.global.locale.value = locale;
    const { backups } = mountReaders();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 502, statusText: 'Upstream unavailable' }),
    );
    await backups.loadDetailUpdateOperations();
    expect(backups.updateOperationsError.value).toBe(
      `${i18n.global.t('containerComponents.backups.operationHistoryLoadFailed')} (c1) (HTTP 502): Upstream unavailable`,
    );
    expect(backups.updateOperationsLoading.value).toBe(false);
    const history = [{ id: 'op1', status: 'succeeded', containerId: 'c1' }];
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: history, total: 1 }));
    await backups.loadDetailUpdateOperations();
    expect(backups.updateOperationsError.value).toBeNull();
    expect(backups.detailUpdateOperations.value).toEqual(history);
    expect(backups.rollbackInProgress.value).toBeNull();
    expect(selectedId.value).toBe('c1');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
  });
});

it('ignores an old trigger failure after the selected container changes', async () => {
  const { triggers } = mountReaders();
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const oldRequest = triggers.loadDetailTriggers();
  selectedId.value = 'c2';
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(triggerPayload));
  await triggers.loadDetailTriggers();
  resolve(new Response(null, { status: 503 }));
  await oldRequest;
  expect(triggers.triggerError.value).toBeNull();
  expect(triggers.detailTriggers.value).toEqual(triggerPayload.data);
  expect(triggers.triggersLoading.value).toBe(false);
});
