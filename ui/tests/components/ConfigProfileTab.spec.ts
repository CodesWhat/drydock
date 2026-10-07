import { flushPromises } from '@vue/test-utils';
import ConfigProfileTab from '@/components/config/ConfigProfileTab.vue';
import * as service from '@/services/totp-factor';
import { mountWithPlugins } from '../helpers/mount';

vi.mock('@/services/totp-factor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/totp-factor')>();
  return { ...actual, getTotpFactor: vi.fn() };
});

const profileData = {
  username: 'eve',
  displayName: 'Eve',
  email: '',
  role: 'admin',
  provider: 'basic',
  lastLogin: '',
  sessions: 1,
};

describe('ConfigProfileTab', () => {
  it('carries the two-factor section below the profile card', async () => {
    vi.mocked(service.getTotpFactor).mockResolvedValue({
      status: 'unenrolled',
      recoveryCodesRemaining: 0,
    });

    const wrapper = mountWithPlugins(ConfigProfileTab, {
      props: {
        profileInitials: 'E',
        profileDisplayName: 'Eve',
        profileData,
        profileLoading: false,
        profileError: '',
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Two-factor authentication');
    expect(wrapper.find('[data-testid="totp-enable"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
