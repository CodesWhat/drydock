import { flushPromises } from '@vue/test-utils';
import TriggersView from '@/views/TriggersView.vue';
import { getAllTriggers, runTrigger } from '@/services/trigger';
import { mountWithPlugins } from '../helpers/mount';
import { dataViewStubs } from '../helpers/data-view-stubs';

const { mockRoute } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown> },
}));

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({
    isMobile: { value: false },
  }),
}));

vi.mock('@/services/trigger', () => ({
  getAllTriggers: vi.fn(),
  runTrigger: vi.fn(),
}));

const mockGetAllTriggers = getAllTriggers as ReturnType<typeof vi.fn>;
const mockRunTrigger = runTrigger as ReturnType<typeof vi.fn>;

function makeTrigger(overrides: Record<string, any> = {}) {
  return {
    id: 'trigger:slack-alerts',
    name: 'Slack Alerts',
    type: 'slack',
    configuration: { channel: '#alerts' },
    ...overrides,
  };
}

async function mountTriggersView() {
  const wrapper = mountWithPlugins(TriggersView, {
    global: { stubs: dataViewStubs },
  });
  await flushPromises();
  return wrapper;
}

function findButtonByText(wrapper: any, label: string) {
  return wrapper.findAll('button').find((button: any) => button.text().includes(label));
}

describe('TriggersView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.query = {};

    mockGetAllTriggers.mockResolvedValue([
      makeTrigger(),
      makeTrigger({
        id: 'trigger:smtp-reports',
        name: 'SMTP Reports',
        type: 'smtp',
        configuration: { from: 'drydock@example.com' },
      }),
    ]);

    mockRunTrigger.mockResolvedValue({ ok: true });
  });

  it('successful load renders trigger rows', async () => {
    const wrapper = await mountTriggersView();

    expect(mockGetAllTriggers).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('2');
  });

  it('route query q filters rows', async () => {
    mockRoute.query = { q: 'slack' };

    const wrapper = await mountTriggersView();

    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('slack');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
  });

  it('clicking "Test Trigger" in detail panel calls runTrigger with expected payload', async () => {
    const wrapper = await mountTriggersView();

    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    const testButton = findButtonByText(wrapper, 'Test Trigger');
    expect(testButton).toBeDefined();

    await testButton?.trigger('click');
    await flushPromises();

    expect(mockRunTrigger).toHaveBeenCalledTimes(1);
    expect(mockRunTrigger).toHaveBeenCalledWith({
      triggerType: 'slack',
      triggerName: 'Slack Alerts',
      container: {
        id: 'test',
        name: 'Test Container',
        image: { name: 'test/image', tag: { value: 'latest' } },
        result: { tag: 'latest' },
        updateKind: { kind: 'unknown', semverDiff: 'unknown' },
      },
    });
  });

  it('API load failure shows "Failed to load triggers"', async () => {
    mockGetAllTriggers.mockRejectedValue(new Error('boom'));

    const wrapper = await mountTriggersView();

    expect(wrapper.text()).toContain('Failed to load triggers');
  });

  it('shows parsed trigger failure reason in the detail panel', async () => {
    mockRunTrigger.mockRejectedValueOnce(
      new Error(
        'Error when running trigger http.local (Unable to authenticate HTTP trigger http.local: bearer token is missing)',
      ),
    );

    const wrapper = await mountTriggersView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    const testButton = findButtonByText(wrapper, 'Test Trigger');
    expect(testButton).toBeDefined();

    await testButton?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      'Unable to authenticate HTTP trigger http.local: bearer token is missing',
    );
  });

  it('shows fallback trigger failure message when error has no text', async () => {
    mockRunTrigger.mockRejectedValueOnce({});

    const wrapper = await mountTriggersView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    const testButton = findButtonByText(wrapper, 'Test Trigger');
    expect(testButton).toBeDefined();

    await testButton?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Trigger test failed');
  });
});
