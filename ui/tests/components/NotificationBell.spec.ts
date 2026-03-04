import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import NotificationBell from '@/components/NotificationBell.vue';

const mockPush = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockEntries = vi.hoisted(() => [
  {
    id: '1',
    timestamp: new Date(Date.now() - 30_000).toISOString(),
    action: 'update-available',
    containerName: 'nginx',
    fromVersion: '1.24',
    toVersion: '1.25',
    status: 'info' as const,
  },
  {
    id: '2',
    timestamp: new Date(Date.now() - 3_600_000).toISOString(),
    action: 'security-alert',
    containerName: 'redis',
    status: 'error' as const,
    details: 'CVE-2024-1234',
  },
]);

const mockGetAuditLog = vi.fn().mockResolvedValue({ entries: mockEntries });
vi.mock('@/services/audit', () => ({
  getAuditLog: (...args: unknown[]) => mockGetAuditLog(...args),
}));

const iconStub = { template: '<span />', props: ['name', 'size'] };
const transitionStub = {
  template: '<slot />',
  props: ['name'],
};

function findDropdown(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('.notification-bell-wrapper div.absolute');
}

function findEntryRows(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.notification-bell-wrapper button.w-full.text-left');
}

describe('NotificationBell', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockGetAuditLog.mockClear().mockResolvedValue({ entries: mockEntries });
    localStorage.clear();
  });

  function factory() {
    return mount(NotificationBell, {
      global: { stubs: { AppIcon: iconStub, Transition: transitionStub } },
    });
  }

  async function openBell(wrapper: ReturnType<typeof mount>) {
    await wrapper.find('button[aria-label="Notifications"]').trigger('click');
    await flushPromises();
  }

  it('renders the bell button', () => {
    const wrapper = factory();
    expect(wrapper.find('button[aria-label="Notifications"]').exists()).toBe(true);
  });

  it('fetches entries on mount', async () => {
    factory();
    await flushPromises();
    expect(mockGetAuditLog).toHaveBeenCalledWith({ limit: 20 });
  });

  it('shows badge with unread count when no lastSeen', async () => {
    const wrapper = factory();
    await flushPromises();
    const badge = wrapper.find('.badge-pulse');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('2');
  });

  it('caps badge at 9+', async () => {
    const manyEntries = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      action: 'update-available',
      containerName: `container-${i}`,
      status: 'info' as const,
    }));
    mockGetAuditLog.mockResolvedValue({ entries: manyEntries });
    const wrapper = factory();
    await flushPromises();
    expect(wrapper.find('.badge-pulse').text()).toBe('9+');
  });

  it('hides badge when all entries are read', async () => {
    localStorage.setItem('dd-bell-last-seen', JSON.stringify(new Date().toISOString()));
    const wrapper = factory();
    await flushPromises();
    expect(wrapper.find('.badge-pulse').exists()).toBe(false);
  });

  it('opens dropdown on click', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    expect(findDropdown(wrapper).exists()).toBe(true);
  });

  it('closes dropdown on second click', async () => {
    const wrapper = factory();
    await flushPromises();
    const btn = wrapper.find('button[aria-label="Notifications"]');
    await btn.trigger('click');
    await flushPromises();
    expect(findDropdown(wrapper).exists()).toBe(true);
    await btn.trigger('click');
    await flushPromises();
    expect(findDropdown(wrapper).exists()).toBe(false);
  });

  it('refetches on open', async () => {
    const wrapper = factory();
    await flushPromises();
    mockGetAuditLog.mockClear();
    await openBell(wrapper);
    expect(mockGetAuditLog).toHaveBeenCalledWith({ limit: 20 });
  });

  it('renders entry rows with correct action labels', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const rows = findEntryRows(wrapper);
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('Update Available');
    expect(rows[1].text()).toContain('Security Alert');
  });

  it('renders container names', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const rows = findEntryRows(wrapper);
    expect(rows[0].text()).toContain('nginx');
    expect(rows[1].text()).toContain('redis');
  });

  it('renders version summary', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const rows = findEntryRows(wrapper);
    expect(rows[0].text()).toContain('1.24');
    expect(rows[0].text()).toContain('1.25');
  });

  it('navigates to audit page on entry click', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const rows = findEntryRows(wrapper);
    await rows[0].trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/audit?container=nginx');
  });

  it('closes dropdown on entry click', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const rows = findEntryRows(wrapper);
    await rows[0].trigger('click');
    await nextTick();
    expect(findDropdown(wrapper).exists()).toBe(false);
  });

  it('navigates to /audit on "View all" click', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const viewAll = wrapper.findAll('.notification-bell-wrapper button.text-center');
    await viewAll[viewAll.length - 1].trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/audit');
  });

  it('shows mark all read button when there are unread entries', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const markBtn = wrapper.findAll('button').find((b) => b.text().includes('Mark all read'));
    expect(markBtn).toBeTruthy();
  });

  it('mark all read clears unread badge', async () => {
    const wrapper = factory();
    await flushPromises();
    expect(wrapper.find('.badge-pulse').exists()).toBe(true);
    await openBell(wrapper);
    const markBtn = wrapper.findAll('button').find((b) => b.text().includes('Mark all read'));
    await markBtn!.trigger('click');
    await nextTick();
    expect(wrapper.find('.badge-pulse').exists()).toBe(false);
  });

  it('shows empty state when no entries', async () => {
    mockGetAuditLog.mockResolvedValue({ entries: [] });
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    expect(wrapper.text()).toContain('No notifications yet');
  });

  it('shows loading state', async () => {
    let resolvePromise: (value: unknown) => void;
    mockGetAuditLog.mockReturnValue(
      new Promise((r) => {
        resolvePromise = r;
      }),
    );
    const wrapper = factory();
    await openBell(wrapper);
    expect(wrapper.text()).toContain('Loading...');
    resolvePromise!({ entries: mockEntries });
    await flushPromises();
    expect(wrapper.text()).not.toContain('Loading...');
  });

  it('bolds unread entries and dims read ones', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    // All entries are unread (no lastSeen)
    const boldLabels = wrapper.findAll(
      '.notification-bell-wrapper button.w-full.text-left .font-bold',
    );
    expect(boldLabels.length).toBe(2);
    // Mark all read
    const markBtn = wrapper.findAll('button').find((b) => b.text().includes('Mark all read'));
    await markBtn!.trigger('click');
    await nextTick();
    // Now entries should have font-medium instead of font-bold
    const boldAfter = wrapper.findAll(
      '.notification-bell-wrapper button.w-full.text-left .font-bold',
    );
    expect(boldAfter.length).toBe(0);
    const mediumAfter = wrapper.findAll(
      '.notification-bell-wrapper button.w-full.text-left .font-medium',
    );
    expect(mediumAfter.length).toBe(2);
  });

  it('SSE container-changed event triggers refetch', async () => {
    factory();
    await flushPromises();
    mockGetAuditLog.mockClear();
    globalThis.dispatchEvent(new Event('dd:sse-container-changed'));
    expect(mockGetAuditLog).toHaveBeenCalled();
  });

  it('SSE scan-completed event triggers refetch', async () => {
    factory();
    await flushPromises();
    mockGetAuditLog.mockClear();
    globalThis.dispatchEvent(new Event('dd:sse-scan-completed'));
    expect(mockGetAuditLog).toHaveBeenCalled();
  });

  it('sets aria-expanded on toggle', async () => {
    const wrapper = factory();
    const btn = wrapper.find('button[aria-label="Notifications"]');
    expect(btn.attributes('aria-expanded')).toBe('false');
    await btn.trigger('click');
    expect(btn.attributes('aria-expanded')).toBe('true');
  });

  it('handles fetch error gracefully', async () => {
    mockGetAuditLog.mockRejectedValue(new Error('network'));
    const wrapper = factory();
    await flushPromises();
    expect(wrapper.find('.badge-pulse').exists()).toBe(false);
  });

  it('encodes container name in URL', async () => {
    const specialEntry = [
      {
        id: '3',
        timestamp: new Date().toISOString(),
        action: 'update-available',
        containerName: 'my app/test',
        status: 'info' as const,
      },
    ];
    mockGetAuditLog.mockResolvedValue({ entries: specialEntry });
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const rows = findEntryRows(wrapper);
    await rows[0].trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/audit?container=my%20app%2Ftest');
  });

  it('hides mark all read button when no unread', async () => {
    localStorage.setItem('dd-bell-last-seen', JSON.stringify(new Date().toISOString()));
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const markBtn = wrapper.findAll('button').find((b) => b.text().includes('Mark all read'));
    expect(markBtn).toBeUndefined();
  });
});
