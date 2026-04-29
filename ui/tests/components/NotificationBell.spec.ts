import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import NotificationBell from '@/components/NotificationBell.vue';
import { tooltip as tooltipDirective } from '@/directives/tooltip';

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
const mountedWrappers: ReturnType<typeof mount>[] = [];

function findDropdown(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-test="notification-dropdown"]');
}

function findEntryRows(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[data-test="notification-row"]');
}

function findEntryBodyButtons(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[data-test="notification-row"] button.text-left');
}

describe('NotificationBell', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockGetAuditLog.mockClear().mockResolvedValue({ entries: mockEntries });
    localStorage.clear();
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    vi.useRealTimers();
  });

  function factory() {
    const wrapper = mount(NotificationBell, {
      global: {
        stubs: { AppIcon: iconStub, Transition: transitionStub },
        directives: { tooltip: tooltipDirective },
      },
    });
    mountedWrappers.push(wrapper);
    return wrapper;
  }

  async function openBell(wrapper: ReturnType<typeof mount>) {
    await wrapper.find('button[aria-label="Notifications"]').trigger('click');
    await flushPromises();
  }

  it('renders the bell button', () => {
    const wrapper = factory();
    expect(wrapper.find('button[aria-label="Notifications"]').exists()).toBe(true);
  });

  it('fetches entries on mount with actionable action filter', async () => {
    factory();
    await flushPromises();
    expect(mockGetAuditLog).toHaveBeenCalledWith({
      limit: 20,
      actions: [
        'update-available',
        'update-applied',
        'update-failed',
        'notification-delivery-failed',
        'security-alert',
        'agent-disconnect',
      ],
    });
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

  it('constrains dropdown width on narrow viewports', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const className = findDropdown(wrapper).attributes('class');
    expect(className).toContain('w-[calc(100vw-1rem)]');
    expect(className).toContain('max-w-[380px]');
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

  it('refetches on open with actionable action filter', async () => {
    const wrapper = factory();
    await flushPromises();
    mockGetAuditLog.mockClear();
    await openBell(wrapper);
    expect(mockGetAuditLog).toHaveBeenCalledWith({
      limit: 20,
      actions: [
        'update-available',
        'update-applied',
        'update-failed',
        'notification-delivery-failed',
        'security-alert',
        'agent-disconnect',
      ],
    });
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

  it('renders version summary with both from and to versions', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const rows = findEntryRows(wrapper);
    expect(rows[0].text()).toContain('1.24');
    expect(rows[0].text()).toContain('1.25');
  });

  it('renders version summary with only toVersion (no fromVersion)', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [
        {
          id: '1',
          timestamp: new Date(Date.now() - 30_000).toISOString(),
          action: 'update-applied',
          containerName: 'nginx',
          toVersion: '1.25',
          status: 'success' as const,
        },
      ],
    });
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const summary = wrapper.get('[data-test="notification-version-summary"]');
    expect(summary.text()).toBe('1.25');
  });

  it('truncates long version summaries and keeps the full value on hover', async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [
        {
          id: '1',
          timestamp: new Date(Date.now() - 30_000).toISOString(),
          action: 'update-available',
          containerName: 'nginx',
          fromVersion: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          toVersion: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          status: 'info' as const,
        },
      ],
    });

    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);

    const summary = wrapper.get('[data-test="notification-version-summary"]');
    expect(summary.classes()).toContain('truncate');
    expect(summary.attributes('title')).toContain(
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(summary.attributes('title')).toContain(
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );

    await summary.trigger('mouseenter');
    expect(summary.attributes('title')).toBeUndefined();
    await summary.trigger('mouseleave');
    expect(summary.attributes('title')).toContain(
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(summary.attributes('title')).toContain(
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    expect(summary.text()).toContain(
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(summary.text()).toContain(
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
  });

  it('navigates to audit page on entry click', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const rows = findEntryBodyButtons(wrapper);
    await rows[0].trigger('click');
    expect(mockPush).toHaveBeenCalledWith({ path: '/audit', query: { container: 'nginx' } });
  });

  it('closes dropdown on entry click', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const rows = findEntryBodyButtons(wrapper);
    await rows[0].trigger('click');
    await nextTick();
    expect(findDropdown(wrapper).exists()).toBe(false);
  });

  it('navigates to /audit on "Open audit log" footer click', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const openLog = wrapper.find('[data-test="open-audit-log-btn"]');
    expect(openLog.exists()).toBe(true);
    await openLog.trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/audit');
  });

  it('keeps "Open audit log" button visible even when there are no entries', async () => {
    mockGetAuditLog.mockResolvedValue({ entries: [] });
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    expect(wrapper.find('[data-test="open-audit-log-btn"]').exists()).toBe(true);
  });

  it('shows mark all read button in the footer when there are unread entries', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const markBtn = wrapper.find('[data-test="mark-all-read-btn"]');
    expect(markBtn.exists()).toBe(true);
    expect(markBtn.text()).toContain('Mark all as read');
  });

  it('header contains the Notifications label', async () => {
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    const header = findDropdown(wrapper).find('div.px-3.py-2');
    expect(header.exists()).toBe(true);
    expect(header.text()).toContain('Notifications');
  });

  it('mark all read clears unread badge', async () => {
    const wrapper = factory();
    await flushPromises();
    expect(wrapper.find('.badge-pulse').exists()).toBe(true);
    await openBell(wrapper);
    await wrapper.find('[data-test="mark-all-read-btn"]').trigger('click');
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
    const boldLabels = wrapper.findAll('[data-test="notification-row"] .font-bold');
    expect(boldLabels.length).toBe(2);
    await wrapper.find('[data-test="mark-all-read-btn"]').trigger('click');
    await nextTick();
    const boldAfter = wrapper.findAll('[data-test="notification-row"] .font-bold');
    expect(boldAfter.length).toBe(0);
    const mediumAfter = wrapper.findAll('[data-test="notification-row"] .font-medium');
    expect(mediumAfter.length).toBe(2);
  });

  it('debounces burst SSE events into one refetch', async () => {
    vi.useFakeTimers();
    try {
      factory();
      await flushPromises();
      mockGetAuditLog.mockClear();

      globalThis.dispatchEvent(new Event('dd:sse-container-changed'));
      globalThis.dispatchEvent(new Event('dd:sse-scan-completed'));
      globalThis.dispatchEvent(new Event('dd:sse-connected'));
      globalThis.dispatchEvent(new Event('dd:sse-container-changed'));
      await flushPromises();

      expect(mockGetAuditLog).not.toHaveBeenCalled();

      vi.advanceTimersByTime(799);
      await flushPromises();
      expect(mockGetAuditLog).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      await flushPromises();
      expect(mockGetAuditLog).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches when the SSE connection is re-established', async () => {
    vi.useFakeTimers();
    try {
      factory();
      await flushPromises();
      expect(mockGetAuditLog).toHaveBeenCalledTimes(1);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
      await flushPromises();
      expect(mockGetAuditLog).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(800);
      await flushPromises();
      expect(mockGetAuditLog).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels pending SSE refetch on unmount', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = factory();
      await flushPromises();
      mockGetAuditLog.mockClear();

      globalThis.dispatchEvent(new Event('dd:sse-scan-completed'));
      await flushPromises();
      wrapper.unmount();

      vi.advanceTimersByTime(800);
      await flushPromises();
      expect(mockGetAuditLog).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('lifecycle event subscriptions', () => {
    it('triggers debounced fetchEntries on dd:sse-update-operation-changed', async () => {
      vi.useFakeTimers();
      try {
        factory();
        await flushPromises();
        mockGetAuditLog.mockClear();

        globalThis.dispatchEvent(new Event('dd:sse-update-operation-changed'));
        await flushPromises();
        expect(mockGetAuditLog).not.toHaveBeenCalled();

        vi.advanceTimersByTime(800);
        await flushPromises();
        expect(mockGetAuditLog).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('triggers debounced fetchEntries on dd:sse-update-applied', async () => {
      vi.useFakeTimers();
      try {
        factory();
        await flushPromises();
        mockGetAuditLog.mockClear();

        globalThis.dispatchEvent(new Event('dd:sse-update-applied'));
        await flushPromises();
        expect(mockGetAuditLog).not.toHaveBeenCalled();

        vi.advanceTimersByTime(800);
        await flushPromises();
        expect(mockGetAuditLog).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('debounces a burst of mixed lifecycle events into one refetch', async () => {
      vi.useFakeTimers();
      try {
        factory();
        await flushPromises();
        mockGetAuditLog.mockClear();

        globalThis.dispatchEvent(new Event('dd:sse-update-operation-changed'));
        globalThis.dispatchEvent(new Event('dd:sse-update-applied'));
        globalThis.dispatchEvent(new Event('dd:sse-update-operation-changed'));
        await flushPromises();
        expect(mockGetAuditLog).not.toHaveBeenCalled();

        vi.advanceTimersByTime(800);
        await flushPromises();
        expect(mockGetAuditLog).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('removes dd:sse-update-operation-changed listener on unmount', async () => {
      vi.useFakeTimers();
      try {
        const wrapper = factory();
        await flushPromises();
        mockGetAuditLog.mockClear();

        wrapper.unmount();

        globalThis.dispatchEvent(new Event('dd:sse-update-operation-changed'));
        vi.advanceTimersByTime(800);
        await flushPromises();
        expect(mockGetAuditLog).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('removes dd:sse-update-applied listener on unmount', async () => {
      vi.useFakeTimers();
      try {
        const wrapper = factory();
        await flushPromises();
        mockGetAuditLog.mockClear();

        wrapper.unmount();

        globalThis.dispatchEvent(new Event('dd:sse-update-applied'));
        vi.advanceTimersByTime(800);
        await flushPromises();
        expect(mockGetAuditLog).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('lastSeen cursor advances on panel close', () => {
    it('advances lastSeen when the panel closes', async () => {
      const before = new Date(Date.now() - 1).toISOString();
      const wrapper = factory();
      await flushPromises();

      expect(wrapper.find('.badge-pulse').exists()).toBe(true);

      // Open then close the panel
      await openBell(wrapper);
      await wrapper.find('button[aria-label="Notifications"]').trigger('click');
      await nextTick();

      const stored = localStorage.getItem('dd-bell-last-seen');
      expect(stored).not.toBeNull();
      const storedVal = JSON.parse(stored!);
      expect(storedVal >= before).toBe(true);
    });

    it('badge goes to zero on re-open when no new entries arrived since last close', async () => {
      const wrapper = factory();
      await flushPromises();

      expect(wrapper.find('.badge-pulse').exists()).toBe(true);

      // Open the panel
      await openBell(wrapper);

      // Close the panel — lastSeen advances to now
      await wrapper.find('button[aria-label="Notifications"]').trigger('click');
      await nextTick();

      // Re-open: all existing entries are now older than lastSeen
      await openBell(wrapper);

      expect(wrapper.find('.badge-pulse').exists()).toBe(false);
    });

    it('does not advance lastSeen when nothing was ever opened', async () => {
      factory();
      await flushPromises();

      // No panel interaction — lastSeen should remain as initially set (empty string)
      expect(localStorage.getItem('dd-bell-last-seen')).toBeNull();
    });

    it('Mark All Read still advances lastSeen to now', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);

      const before = Date.now();
      await wrapper.find('[data-test="mark-all-read-btn"]').trigger('click');
      await nextTick();

      const stored = JSON.parse(localStorage.getItem('dd-bell-last-seen') ?? 'null');
      expect(new Date(stored).getTime()).toBeGreaterThanOrEqual(before);
      expect(wrapper.find('.badge-pulse').exists()).toBe(false);
    });

    it('badge reflects only new entries received after the last panel close', async () => {
      const wrapper = factory();
      await flushPromises();

      // Open and close — lastSeen advances to after the two existing entries
      await openBell(wrapper);
      await wrapper.find('button[aria-label="Notifications"]').trigger('click');
      await nextTick();

      // Simulate a new entry arriving with a future timestamp
      const futureEntry = {
        id: '99',
        timestamp: new Date(Date.now() + 60_000).toISOString(),
        action: 'update-applied',
        containerName: 'postgres',
        status: 'success' as const,
      };
      mockGetAuditLog.mockResolvedValue({ entries: [...mockEntries, futureEntry] });

      // Re-open triggers a refetch that adds the new entry
      await openBell(wrapper);

      // Only the new future-timestamped entry should be unread
      const badge = wrapper.find('.badge-pulse');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('1');
    });

    it('does not advance lastSeen twice when opening then immediately closing again', async () => {
      const wrapper = factory();
      await flushPromises();

      // First open+close cycle
      await openBell(wrapper);
      await wrapper.find('button[aria-label="Notifications"]').trigger('click');
      await nextTick();

      const firstSeen = JSON.parse(localStorage.getItem('dd-bell-last-seen') ?? 'null');
      expect(firstSeen).not.toBeNull();

      // Second open+close cycle — lastSeen should advance again (>= first value)
      await openBell(wrapper);
      await wrapper.find('button[aria-label="Notifications"]').trigger('click');
      await nextTick();

      const secondSeen = JSON.parse(localStorage.getItem('dd-bell-last-seen') ?? 'null');
      expect(secondSeen >= firstSeen).toBe(true);
    });
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

  it('falls back to empty array when audit log response has no entries property', async () => {
    mockGetAuditLog.mockResolvedValue({});
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    expect(findEntryRows(wrapper)).toHaveLength(0);
    expect(wrapper.text()).toContain('No notifications yet');
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
    const rows = findEntryBodyButtons(wrapper);
    await rows[0].trigger('click');
    expect(mockPush).toHaveBeenCalledWith({ path: '/audit', query: { container: 'my app/test' } });
  });

  it('hides mark all read button when no unread', async () => {
    localStorage.setItem('dd-bell-last-seen', JSON.stringify(new Date().toISOString()));
    const wrapper = factory();
    await flushPromises();
    await openBell(wrapper);
    expect(wrapper.find('[data-test="mark-all-read-btn"]').exists()).toBe(false);
  });

  describe('click-outside behaviour', () => {
    it('closes the panel on pointerdown outside the wrapper', async () => {
      const attachDiv = document.createElement('div');
      document.body.appendChild(attachDiv);
      const wrapper = mount(NotificationBell, {
        attachTo: attachDiv,
        global: {
          stubs: { AppIcon: iconStub, Transition: transitionStub },
          directives: { tooltip: tooltipDirective },
        },
      });
      mountedWrappers.push(wrapper);

      await flushPromises();
      await wrapper.find('button[aria-label="Notifications"]').trigger('click');
      await flushPromises();
      expect(findDropdown(wrapper).exists()).toBe(true);

      // Click on a true external element (not inside the wrapper)
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await nextTick();
      expect(findDropdown(wrapper).exists()).toBe(false);

      document.body.removeChild(outside);
      document.body.removeChild(attachDiv);
    });

    it('does not close the panel on pointerdown inside the wrapper', async () => {
      const attachDiv = document.createElement('div');
      document.body.appendChild(attachDiv);
      const wrapper = mount(NotificationBell, {
        attachTo: attachDiv,
        global: {
          stubs: { AppIcon: iconStub, Transition: transitionStub },
          directives: { tooltip: tooltipDirective },
        },
      });
      mountedWrappers.push(wrapper);

      await flushPromises();
      await wrapper.find('button[aria-label="Notifications"]').trigger('click');
      await flushPromises();
      expect(findDropdown(wrapper).exists()).toBe(true);

      // Click on an element inside the notification-bell-wrapper
      const wrapperEl = wrapper.find('.notification-bell-wrapper').element;
      wrapperEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await nextTick();
      // Panel should remain open
      expect(findDropdown(wrapper).exists()).toBe(true);

      document.body.removeChild(attachDiv);
    });
  });

  describe('zebra striping', () => {
    it('uses the themeable --dd-zebra-stripe token for alternate rows', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      const rows = findEntryRows(wrapper);
      expect(rows[0].attributes('style')).toContain('var(--dd-bg-card)');
      expect(rows[1].attributes('style')).toContain('var(--dd-zebra-stripe)');
    });
  });

  describe('per-row dismiss', () => {
    it('renders a dismiss button inside every row', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      const dismissButtons = wrapper.findAll('[data-test="notification-dismiss"]');
      expect(dismissButtons.length).toBe(2);
    });

    it('removes only the dismissed entry, leaving the others visible', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      expect(findEntryRows(wrapper)).toHaveLength(2);

      const dismiss = wrapper.findAll('[data-test="notification-dismiss"]');
      await dismiss[0].trigger('click');
      await nextTick();
      const remaining = findEntryRows(wrapper);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].text()).toContain('redis');
      expect(remaining[0].text()).not.toContain('nginx');
    });

    it('does not navigate when the dismiss button is clicked', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      const dismiss = wrapper.findAll('[data-test="notification-dismiss"]');
      await dismiss[0].trigger('click');
      await nextTick();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('persists dismissed entries across re-opens via localStorage', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      const dismiss = wrapper.findAll('[data-test="notification-dismiss"]');
      await dismiss[0].trigger('click');
      await nextTick();

      await wrapper.find('button[aria-label="Notifications"]').trigger('click');
      await nextTick();
      expect(findDropdown(wrapper).exists()).toBe(false);

      await openBell(wrapper);
      expect(findEntryRows(wrapper)).toHaveLength(1);
    });

    it('skips adding the same id twice if dismiss is double-triggered', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      const dismiss = wrapper.findAll('[data-test="notification-dismiss"]');
      await dismiss[0].trigger('click');
      await dismiss[0].trigger('click');
      await nextTick();
      const raw = localStorage.getItem('dd-bell-dismissed-ids');
      expect(raw).toBe(JSON.stringify(['1']));
    });

    it('empty state appears once every entry has been individually dismissed', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      const dismiss = wrapper.findAll('[data-test="notification-dismiss"]');
      await dismiss[0].trigger('click');
      await dismiss[1].trigger('click');
      await nextTick();
      expect(findEntryRows(wrapper)).toHaveLength(0);
      expect(wrapper.text()).toContain('No notifications yet');
    });

    it('falls back to an empty dismiss list when localStorage contains malformed data', async () => {
      localStorage.setItem('dd-bell-dismissed-ids', JSON.stringify({ not: 'an array' }));
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      expect(findEntryRows(wrapper)).toHaveLength(2);
    });

    it('rejects arrays that contain non-string entries', async () => {
      localStorage.setItem('dd-bell-dismissed-ids', JSON.stringify(['1', 42, null]));
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      expect(findEntryRows(wrapper)).toHaveLength(2);
    });

    it('surfaces new entries whose ids are not in the dismissed list', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      const dismiss = wrapper.findAll('[data-test="notification-dismiss"]');
      await dismiss[0].trigger('click');
      await dismiss[1].trigger('click');
      await nextTick();
      expect(findEntryRows(wrapper)).toHaveLength(0);

      const futureEntry = {
        id: '99',
        timestamp: new Date(Date.now() + 60_000).toISOString(),
        action: 'update-available',
        containerName: 'postgres',
        status: 'info' as const,
      };
      mockGetAuditLog.mockResolvedValue({ entries: [...mockEntries, futureEntry] });

      await wrapper.find('button[aria-label="Notifications"]').trigger('click');
      await nextTick();
      await openBell(wrapper);
      expect(findEntryRows(wrapper)).toHaveLength(1);
      expect(wrapper.text()).toContain('postgres');
    });
  });

  describe('bulk clear', () => {
    it('Clear button is hidden when there are no entries', async () => {
      mockGetAuditLog.mockResolvedValue({ entries: [] });
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      expect(wrapper.find('[data-test="clear-all-btn"]').exists()).toBe(false);
    });

    it('Clear button is hidden when all entries are already dismissed', async () => {
      localStorage.setItem('dd-bell-dismissed-ids', JSON.stringify(['1', '2']));
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      expect(wrapper.find('[data-test="clear-all-btn"]').exists()).toBe(false);
    });

    it('Clear button is visible when entries exist', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      expect(wrapper.find('[data-test="clear-all-btn"]').exists()).toBe(true);
    });

    it('clicking Clear dismisses all visible entries', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      expect(findEntryRows(wrapper)).toHaveLength(2);

      await wrapper.find('[data-test="clear-all-btn"]').trigger('click');
      await new Promise((r) => setTimeout(r, 200));

      expect(findEntryRows(wrapper)).toHaveLength(0);
      expect(wrapper.text()).toContain('No notifications yet');
    });

    it('clicking Clear persists dismissed ids to localStorage', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      await wrapper.find('[data-test="clear-all-btn"]').trigger('click');
      await new Promise((r) => setTimeout(r, 200));

      const raw = localStorage.getItem('dd-bell-dismissed-ids');
      const stored = JSON.parse(raw ?? '[]') as string[];
      expect(stored).toContain('1');
      expect(stored).toContain('2');
    });

    it('Clear hides after dismissing everything', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      await wrapper.find('[data-test="clear-all-btn"]').trigger('click');
      await new Promise((r) => setTimeout(r, 200));

      expect(wrapper.find('[data-test="clear-all-btn"]').exists()).toBe(false);
    });

    it('Clear does not duplicate existing dismissed ids', async () => {
      localStorage.setItem('dd-bell-dismissed-ids', JSON.stringify(['1']));
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      await wrapper.find('[data-test="clear-all-btn"]').trigger('click');
      await new Promise((r) => setTimeout(r, 200));

      const raw = localStorage.getItem('dd-bell-dismissed-ids');
      const stored = JSON.parse(raw ?? '[]') as string[];
      const count1 = stored.filter((id) => id === '1').length;
      expect(count1).toBe(1);
      expect(stored).toContain('2');
    });

    it('Clear does not mark entries as read (lastSeen unchanged)', async () => {
      const wrapper = factory();
      await flushPromises();
      await openBell(wrapper);
      await wrapper.find('[data-test="clear-all-btn"]').trigger('click');
      await new Promise((r) => setTimeout(r, 200));

      expect(localStorage.getItem('dd-bell-last-seen')).toBeNull();
    });
  });
});
