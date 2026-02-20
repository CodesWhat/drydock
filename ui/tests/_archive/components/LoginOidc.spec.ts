import { mount } from '@vue/test-utils';
import LoginOidc from '@/components/LoginOidc';
import { getOidcRedirection } from '@/services/auth';

vi.mock('@/services/auth', () => ({
  getOidcRedirection: vi.fn(() => Promise.resolve({ url: 'http://test.com' })),
}));

describe('LoginOidc', () => {
  let wrapper;
  const originalLocation = window.location;

  beforeAll(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    });
  });

  afterAll(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  beforeEach(() => {
    vi.mocked(getOidcRedirection).mockClear();
    wrapper = mount(LoginOidc, {
      props: {
        name: 'test-provider',
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it('renders OIDC login button', () => {
    expect(wrapper.find('.v-btn').exists()).toBe(true);
  });

  it('handles login click', async () => {
    await wrapper.find('.v-btn').trigger('click');
    expect(getOidcRedirection).toHaveBeenCalledWith('test-provider');
    expect(window.location.href).toBe('http://test.com');
  });

  it('uses primary button color by default and secondary in dark mode', async () => {
    const button = wrapper.findComponent({ name: 'v-btn' });
    expect(button.props('color')).toBe('primary');

    await wrapper.setProps({ dark: true });
    expect(button.props('color')).toBe('secondary');
  });
});
