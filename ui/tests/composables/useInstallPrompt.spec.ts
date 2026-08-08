import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useInstallPrompt } from '@/composables/useInstallPrompt';

function mountComposable() {
  let result!: ReturnType<typeof useInstallPrompt>;
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useInstallPrompt();
        return () => h('div');
      },
    }),
  );
  return {
    wrapper,
    get result() {
      return result;
    },
  };
}

function makeBeforeInstallPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
}

describe('useInstallPrompt', () => {
  it('is unavailable until beforeinstallprompt fires', () => {
    const { result } = mountComposable();

    expect(result.available.value).toBe(false);
  });

  it('becomes available and prevents the default mini-infobar when beforeinstallprompt fires', () => {
    const { result } = mountComposable();
    const event = makeBeforeInstallPromptEvent();
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(result.available.value).toBe(true);
  });

  it('prompts the deferred install and resolves with the outcome', async () => {
    const { result } = mountComposable();
    window.dispatchEvent(makeBeforeInstallPromptEvent('accepted'));

    const outcome = await result.promptInstall();

    expect(outcome).toBe('accepted');
    expect(result.available.value).toBe(false);
  });

  it('resolves dismissed when the user declines the native prompt', async () => {
    const { result } = mountComposable();
    window.dispatchEvent(makeBeforeInstallPromptEvent('dismissed'));

    const outcome = await result.promptInstall();

    expect(outcome).toBe('dismissed');
  });

  it('resolves unavailable when prompted without a captured event', async () => {
    const { result } = mountComposable();

    const outcome = await result.promptInstall();

    expect(outcome).toBe('unavailable');
  });

  it('resolves unavailable on a second prompt call since the event is single-use', async () => {
    const { result } = mountComposable();
    window.dispatchEvent(makeBeforeInstallPromptEvent('accepted'));

    await result.promptInstall();
    const secondOutcome = await result.promptInstall();

    expect(secondOutcome).toBe('unavailable');
  });

  it('becomes unavailable when the app is installed', () => {
    const { result } = mountComposable();
    window.dispatchEvent(makeBeforeInstallPromptEvent());
    expect(result.available.value).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));

    expect(result.available.value).toBe(false);
  });

  it('stops reacting to events once unmounted', () => {
    const { wrapper, result } = mountComposable();
    wrapper.unmount();

    window.dispatchEvent(makeBeforeInstallPromptEvent());

    expect(result.available.value).toBe(false);
  });
});
