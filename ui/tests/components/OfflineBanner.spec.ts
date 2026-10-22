import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import OfflineBanner from '@/components/OfflineBanner.vue';
import { installConnectivityMonitor, useConnectivity } from '@/composables/useConnectivity';

const stubs = { AppIcon: { template: '<span />', props: ['name', 'size'] } };

describe('OfflineBanner', () => {
  let uninstall: () => void;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 200 }) as unknown as typeof fetch;
    uninstall = installConnectivityMonitor();
    useConnectivity().markServerReachable();
    globalThis.dispatchEvent(new Event('online'));
  });

  afterEach(() => {
    uninstall();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  });

  it('renders nothing while online', () => {
    const wrapper = mount(OfflineBanner, { global: { stubs } });

    expect(wrapper.find('[data-testid="offline-banner"]').exists()).toBe(false);
  });

  it('says the server is unreachable and shows when the data was last updated', async () => {
    const c = useConnectivity();
    const wrapper = mount(OfflineBanner, { global: { stubs } });

    c.noteLastKnownServed(Date.UTC(2026, 0, 2, 3, 4));
    c.markServerUnreachable();
    await nextTick();

    const banner = wrapper.get('[data-testid="offline-banner"]');
    expect(banner.text()).toContain('Drydock server unreachable');
    expect(banner.get('[data-testid="offline-banner-last-updated"]').text()).toContain(
      'Last updated',
    );
  });

  it('says the browser is offline, omits the marker without saved data, and clears on reconnect', async () => {
    const wrapper = mount(OfflineBanner, { global: { stubs } });

    globalThis.dispatchEvent(new Event('offline'));
    await nextTick();

    const banner = wrapper.get('[data-testid="offline-banner"]');
    expect(banner.text()).toContain('You are offline');
    expect(wrapper.find('[data-testid="offline-banner-last-updated"]').exists()).toBe(false);

    globalThis.dispatchEvent(new Event('online'));
    await nextTick();
    expect(wrapper.find('[data-testid="offline-banner"]').exists()).toBe(false);
  });

  it('stays dismissed for the current outage and returns for a new one', async () => {
    const c = useConnectivity();
    const wrapper = mount(OfflineBanner, { global: { stubs } });
    c.markServerUnreachable();
    await nextTick();

    await wrapper.get('[data-testid="offline-banner-dismiss-session"]').trigger('click');
    expect(wrapper.find('[data-testid="offline-banner"]').exists()).toBe(false);

    c.markServerReachable();
    await nextTick();
    c.markServerUnreachable();
    await nextTick();
    expect(wrapper.find('[data-testid="offline-banner"]').exists()).toBe(true);
  });
});
