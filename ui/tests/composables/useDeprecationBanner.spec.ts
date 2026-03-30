import { flushPromises } from '@vue/test-utils';
import { useDeprecationBanner } from '@/composables/useDeprecationBanner';

describe('useDeprecationBanner', () => {
  const STORAGE_KEY = 'dd-banner-test-v1';

  beforeEach(() => {
    localStorage.clear();
  });

  it('is not visible when nothing is detected', () => {
    const banner = useDeprecationBanner(STORAGE_KEY);

    expect(banner.visible.value).toBe(false);
    expect(banner.detected.value).toBe(false);
  });

  it('becomes visible when the condition is detected', () => {
    const banner = useDeprecationBanner(STORAGE_KEY);

    banner.detected.value = true;

    expect(banner.visible.value).toBe(true);
  });

  it('hides for the current session on session dismiss', () => {
    const banner = useDeprecationBanner(STORAGE_KEY);
    banner.detected.value = true;

    banner.dismissForSession();

    expect(banner.visible.value).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('hides permanently and persists to localStorage', async () => {
    const banner = useDeprecationBanner(STORAGE_KEY);
    banner.detected.value = true;

    banner.dismissPermanently();
    await flushPromises();

    expect(banner.visible.value).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('stays hidden when localStorage already has a permanent dismissal', () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    const banner = useDeprecationBanner(STORAGE_KEY);
    banner.detected.value = true;

    expect(banner.visible.value).toBe(false);
  });

  it('ignores corrupt localStorage values and defaults to visible', () => {
    localStorage.setItem(STORAGE_KEY, '"not-a-boolean"');

    const banner = useDeprecationBanner(STORAGE_KEY);
    banner.detected.value = true;

    expect(banner.visible.value).toBe(true);
  });
});
