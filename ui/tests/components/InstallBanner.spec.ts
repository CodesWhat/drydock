import { mount } from '@vue/test-utils';
import InstallBanner from '@/components/InstallBanner.vue';

const stubs = {
  AppIcon: { template: '<span />', props: ['name', 'size'] },
};

function makeBeforeInstallPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
}

describe('InstallBanner', () => {
  const STORAGE_KEY = 'dd-banner-pwa-install-v1';

  beforeEach(() => {
    localStorage.clear();
  });

  it('renders nothing until the browser signals installability', () => {
    const wrapper = mount(InstallBanner, { global: { stubs } });

    expect(wrapper.find('[data-testid="pwa-install-banner"]').exists()).toBe(false);
  });

  it('shows the banner once beforeinstallprompt fires', async () => {
    const wrapper = mount(InstallBanner, { global: { stubs } });

    window.dispatchEvent(makeBeforeInstallPromptEvent());
    await wrapper.vm.$nextTick();

    const banner = wrapper.find('[data-testid="pwa-install-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('Install Drydock as an app');
    expect(banner.text()).toContain('Install');
  });

  it('triggers the native install prompt when the action button is clicked', async () => {
    const wrapper = mount(InstallBanner, { global: { stubs } });
    const event = makeBeforeInstallPromptEvent('accepted');
    window.dispatchEvent(event);
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-testid="pwa-install-banner-action"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(event.prompt).toHaveBeenCalled();
  });

  it('dismisses permanently and persists the versioned storage key', async () => {
    const wrapper = mount(InstallBanner, { global: { stubs } });
    window.dispatchEvent(makeBeforeInstallPromptEvent());
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-testid="pwa-install-banner-dismiss-session"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="pwa-install-banner"]').exists()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('stays hidden across remounts once permanently dismissed', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const wrapper = mount(InstallBanner, { global: { stubs } });

    window.dispatchEvent(makeBeforeInstallPromptEvent());
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="pwa-install-banner"]').exists()).toBe(false);
  });

  it('hides again once the app is installed', async () => {
    const wrapper = mount(InstallBanner, { global: { stubs } });
    window.dispatchEvent(makeBeforeInstallPromptEvent());
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="pwa-install-banner"]').exists()).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="pwa-install-banner"]').exists()).toBe(false);
  });
});
