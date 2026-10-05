import LoginSecondFactorStep from '@/components/LoginSecondFactorStep.vue';
import { mountWithPlugins } from '../helpers/mount';

describe('LoginSecondFactorStep', () => {
  it('omits the expiry line when the expiry is not a date', () => {
    const wrapper = mountWithPlugins(LoginSecondFactorStep, {
      props: { methods: ['totp'], expiresAt: 'not-a-date', submitting: false },
    });
    expect(wrapper.text()).not.toContain('Enter the code before');
    wrapper.unmount();
  });

  it('shows the expiry time when it is valid', () => {
    const wrapper = mountWithPlugins(LoginSecondFactorStep, {
      props: { methods: ['totp'], expiresAt: '2026-10-04T12:05:00.000Z', submitting: false },
    });
    expect(wrapper.text()).toContain('Enter the code before');
    wrapper.unmount();
  });

  it('does not emit while a submit is in flight', async () => {
    const wrapper = mountWithPlugins(LoginSecondFactorStep, {
      props: { methods: ['totp'], expiresAt: '2026-10-04T12:05:00.000Z', submitting: true },
    });
    await wrapper.get('input#totp-code').setValue('123456');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
    wrapper.unmount();
  });
});
