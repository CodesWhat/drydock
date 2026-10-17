import { flushPromises } from '@vue/test-utils';
import ConfigTotpFactor from '@/components/config/ConfigTotpFactor.vue';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import * as service from '@/services/totp-factor';
import { TotpRequestError } from '@/services/totp-factor';
import { mountWithPlugins } from '../helpers/mount';

vi.mock('@/services/totp-factor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/totp-factor')>();
  return {
    ...actual,
    getTotpFactor: vi.fn(),
    startTotpEnrollment: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
    cancelTotpEnrollment: vi.fn(),
    replaceTotpRecoveryCodes: vi.fn(),
    removeTotpFactor: vi.fn(),
  };
});

const mockWriteToClipboard = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useClipboard', async () => {
  const actual = await vi.importActual<typeof import('@/composables/useClipboard')>(
    '@/composables/useClipboard',
  );
  return {
    ...actual,
    useClipboard: () => ({
      ...actual.useClipboard(),
      copyToClipboard: async (text: string, key?: string) => {
        mockWriteToClipboard(text, key);
        return true;
      },
    }),
  };
});

const download = vi.hoisted(() => vi.fn());
vi.mock('@/utils/download-text', () => ({ downloadTextFile: download }));

const mocked = vi.mocked(service);

const UNENROLLED = { status: 'unenrolled', recoveryCodesRemaining: 0 } as const;
const ACTIVE = {
  status: 'active',
  activatedAt: '2026-10-01T12:00:00.000Z',
  recoveryCodesRemaining: 10,
} as const;
const REVEAL = {
  id: 'enr-1',
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/Drydock:eve?secret=JBSWY3DPEHPK3PXP',
  expiresAt: '2026-10-01T12:10:00.000Z',
  replacesFactor: false,
};
const CODES = { recoveryCodes: ['aaaa-bbbb', 'cccc-dddd', 'eeee-ffff'] };

function failure(status: number, reason?: string, retryAfter?: number) {
  return new TotpRequestError(`HTTP ${status}`, status, reason, retryAfter);
}

async function mountSection(status: service.TotpFactorStatus = UNENROLLED) {
  mocked.getTotpFactor.mockResolvedValue(status);
  const wrapper = mountWithPlugins(ConfigTotpFactor, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

const byId = (id: string) => `[data-testid="${id}"]`;

async function fillAndSubmitReauth(
  wrapper: Awaited<ReturnType<typeof mountSection>>,
  proof?: string,
) {
  await wrapper.get(byId('totp-password')).setValue('hunter2');
  if (proof !== undefined) {
    await wrapper.get(byId('totp-proof')).setValue(proof);
  }
  await wrapper.get(byId('totp-reauth-form')).trigger('submit');
  await flushPromises();
}

async function toScan(wrapper: Awaited<ReturnType<typeof mountSection>>) {
  mocked.startTotpEnrollment.mockResolvedValue(REVEAL);
  await wrapper.get(byId('totp-enable')).trigger('click');
  await fillAndSubmitReauth(wrapper);
}

async function toCodes(wrapper: Awaited<ReturnType<typeof mountSection>>) {
  await toScan(wrapper);
  mocked.confirmTotpEnrollment.mockResolvedValue(CODES);
  await wrapper.get(byId('totp-confirm-code')).setValue('123456');
  await wrapper.get(byId('totp-confirm-form')).trigger('submit');
  await flushPromises();
}

describe('ConfigTotpFactor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.cancelTotpEnrollment.mockResolvedValue(undefined);
    mockWriteToClipboard.mockClear();
    download.mockClear();
    useConfirmDialog().dismiss();
    vi.spyOn(Storage.prototype, 'setItem');
    vi.spyOn(console, 'log');
    vi.spyOn(console, 'debug');
    vi.spyOn(console, 'info');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('status', () => {
    it('shows a loading state, then that it is off', async () => {
      let release: (value: service.TotpFactorStatus) => void = () => {};
      mocked.getTotpFactor.mockReturnValue(new Promise((resolve) => (release = resolve)));
      const wrapper = mountWithPlugins(ConfigTotpFactor);
      expect(wrapper.text()).toContain('Loading two-factor status');

      release(UNENROLLED);
      await flushPromises();

      expect(wrapper.get(byId('totp-status')).text()).toContain('Off');
      expect(wrapper.find(byId('totp-enable')).exists()).toBe(true);
      expect(wrapper.find(byId('totp-replace')).exists()).toBe(false);
      wrapper.unmount();
    });

    it('shows that it is on, since when, and how many recovery codes are left', async () => {
      const wrapper = await mountSection(ACTIVE);

      const text = wrapper.get(byId('totp-status')).text();
      expect(text).toContain('On since');
      expect(text).toContain('2026');
      expect(text).toContain('10 recovery codes left');
      expect(wrapper.find(byId('totp-enable')).exists()).toBe(false);
      for (const id of ['totp-replace', 'totp-regenerate', 'totp-remove']) {
        expect(wrapper.find(byId(id)).exists()).toBe(true);
      }
      wrapper.unmount();
    });

    it('uses the singular for one code and warns when few are left', async () => {
      const one = await mountSection({ ...ACTIVE, recoveryCodesRemaining: 1 });
      expect(one.get(byId('totp-status')).text()).toContain('1 recovery code left');
      expect(one.find(byId('totp-recovery-warning')).text()).toContain('running low');
      one.unmount();

      const none = await mountSection({ ...ACTIVE, recoveryCodesRemaining: 0 });
      expect(none.get(byId('totp-recovery-warning')).text()).toContain('No recovery codes left');
      none.unmount();

      const plenty = await mountSection(ACTIVE);
      expect(plenty.find(byId('totp-recovery-warning')).exists()).toBe(false);
      plenty.unmount();
    });

    it('shows a pending enrollment with its expiry and lets it be cancelled', async () => {
      const wrapper = await mountSection({
        ...UNENROLLED,
        pendingEnrollment: {
          id: 'old',
          expiresAt: '2026-10-01T12:10:00.000Z',
          replacesFactor: false,
        },
      });
      expect(wrapper.get(byId('totp-pending')).text()).toContain('Setup started');
      expect(wrapper.find(byId('totp-enable')).exists()).toBe(false);

      mocked.getTotpFactor.mockResolvedValue(UNENROLLED);
      await wrapper.get(byId('totp-cancel-pending')).trigger('click');
      await flushPromises();

      expect(mocked.cancelTotpEnrollment).toHaveBeenCalledWith('old');
      expect(wrapper.find(byId('totp-pending')).exists()).toBe(false);
      wrapper.unmount();
    });

    it('leaves out an expiry that is not a date', async () => {
      const wrapper = await mountSection({
        ...UNENROLLED,
        pendingEnrollment: { id: 'old', expiresAt: 'later', replacesFactor: false },
      });
      expect(wrapper.get(byId('totp-pending')).text()).toContain('later');
      wrapper.unmount();
    });

    it('prints a date it cannot parse as it came', async () => {
      const wrapper = await mountSection({ ...ACTIVE, activatedAt: 'sometime' });
      expect(wrapper.get(byId('totp-status')).text()).toContain('sometime');
      wrapper.unmount();
    });
  });

  describe('load failures and unavailable states', () => {
    it.each([
      [failure(500), 'Couldn’t load two-factor status.'.replace('’', "'")],
      [new TypeError('x'), "Couldn't reach the server."],
      [failure(401), 'Your session ended.'],
    ])('shows %s with a retry that works', async (error, text) => {
      mocked.getTotpFactor.mockRejectedValueOnce(error);
      const wrapper = mountWithPlugins(ConfigTotpFactor);
      await flushPromises();
      expect(wrapper.get(byId('totp-load-error')).text()).toContain(text);

      mocked.getTotpFactor.mockResolvedValue(UNENROLLED);
      await wrapper.get(byId('totp-retry')).trigger('click');
      await flushPromises();

      expect(wrapper.find(byId('totp-load-error')).exists()).toBe(false);
      expect(wrapper.find(byId('totp-enable')).exists()).toBe(true);
      wrapper.unmount();
    });

    it('explains a session that is not a local account, with no actions', async () => {
      mocked.getTotpFactor.mockRejectedValue(failure(403));
      const wrapper = mountWithPlugins(ConfigTotpFactor);
      await flushPromises();

      expect(wrapper.get(byId('totp-unavailable')).text()).toContain(
        'only available for local accounts',
      );
      expect(wrapper.find(byId('totp-enable')).exists()).toBe(false);
      expect(wrapper.find(byId('totp-status')).exists()).toBe(false);
      wrapper.unmount();
    });

    it.each([
      [failure(403, 'https-required'), 'needs HTTPS', 'DD_AUTH_TOTP_ALLOWHTTP'],
      [failure(503), 'encryption key ring', 'key ring'],
      [failure(403, 'recovery-assurance'), 'recovery code', 'authenticator app'],
    ])('explains %s once the first step is refused', async (error, text, extra) => {
      const wrapper = await mountSection();
      mocked.startTotpEnrollment.mockRejectedValue(error);
      await wrapper.get(byId('totp-enable')).trigger('click');
      await fillAndSubmitReauth(wrapper);

      const message = wrapper.get(byId('totp-unavailable')).text();
      expect(message).toContain(text);
      expect(message).toContain(extra);
      expect(wrapper.find(byId('totp-reauth-form')).exists()).toBe(false);
      expect(wrapper.find(byId('totp-enable')).exists()).toBe(false);
      expect(wrapper.find(byId('totp-status')).exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('enabling', () => {
    it('asks for the password first, as a password field, and focuses it', async () => {
      const wrapper = await mountSection();

      await wrapper.get(byId('totp-enable')).trigger('click');
      await flushPromises();

      const password = wrapper.get(byId('totp-password'));
      expect(password.attributes('type')).toBe('password');
      expect(password.attributes('autocomplete')).toBe('current-password');
      expect(wrapper.find(byId('totp-proof')).exists()).toBe(false);
      expect(document.activeElement).toBe(password.element);
      expect(wrapper.get(byId('totp-reauth-form')).text()).toContain("Confirm it's you");
      wrapper.unmount();
    });

    it('shows the QR code, the secret as text and a confirm field after the password', async () => {
      const wrapper = await mountSection();

      await toScan(wrapper);

      expect(mocked.startTotpEnrollment).toHaveBeenCalledWith({ password: 'hunter2' });
      expect(wrapper.find('svg[role="img"]').exists()).toBe(true);
      expect(wrapper.get(byId('totp-secret')).text()).toBe('JBSWY3DPEHPK3PXP');
      expect(wrapper.get(byId('totp-scan')).text()).toContain('This setup expires at');
      const code = wrapper.get(byId('totp-confirm-code'));
      expect(code.attributes('autocomplete')).toBe('one-time-code');
      expect(code.attributes('inputmode')).toBe('numeric');
      expect(code.attributes('type')).toBe('text');
      expect(document.activeElement).toBe(code.element);
      expect(wrapper.html()).not.toContain('hunter2');
      expect(wrapper.find(byId('totp-replace-note')).exists()).toBe(false);
      wrapper.unmount();
    });

    it('copies the setup key', async () => {
      const wrapper = await mountSection();
      await toScan(wrapper);

      await wrapper.get(byId('totp-copy-secret')).trigger('click');
      await flushPromises();

      expect(mockWriteToClipboard).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP', 'totp-secret');
      wrapper.unmount();
    });

    it('keeps the confirm button off until six digits are in, and strips everything else', async () => {
      const wrapper = await mountSection();
      await toScan(wrapper);
      const button = wrapper.get(byId('totp-confirm-submit'));
      expect(button.attributes('disabled')).toBeDefined();

      await wrapper.get(byId('totp-confirm-code')).setValue('12a 34');
      expect((wrapper.get(byId('totp-confirm-code')).element as HTMLInputElement).value).toBe(
        '1234',
      );
      expect(button.attributes('disabled')).toBeDefined();

      await wrapper.get(byId('totp-confirm-code')).setValue('123 456 789');
      expect((wrapper.get(byId('totp-confirm-code')).element as HTMLInputElement).value).toBe(
        '123456',
      );
      expect(button.attributes('disabled')).toBeUndefined();
      wrapper.unmount();
    });

    it('does not send a short code even if the form is submitted anyway', async () => {
      const wrapper = await mountSection();
      await toScan(wrapper);
      await wrapper.get(byId('totp-confirm-code')).setValue('123');

      await wrapper.get(byId('totp-confirm-form')).trigger('submit');
      await flushPromises();

      expect(mocked.confirmTotpEnrollment).not.toHaveBeenCalled();
      expect(wrapper.get(byId('totp-error')).text()).toContain('Enter the 6 digits');
      wrapper.unmount();
    });

    it('says so on a wrong code, empties the field and stays put', async () => {
      const wrapper = await mountSection();
      await toScan(wrapper);
      mocked.confirmTotpEnrollment.mockRejectedValue(failure(422));
      await wrapper.get(byId('totp-confirm-code')).setValue('000000');

      await wrapper.get(byId('totp-confirm-form')).trigger('submit');
      await flushPromises();

      expect(wrapper.get(byId('totp-error')).text()).toContain("That code didn't work");
      expect((wrapper.get(byId('totp-confirm-code')).element as HTMLInputElement).value).toBe('');
      expect(wrapper.find(byId('totp-scan')).exists()).toBe(true);
      wrapper.unmount();
    });

    it('shows the replacement note when a factor is being replaced', async () => {
      const wrapper = await mountSection(ACTIVE);
      mocked.startTotpEnrollment.mockResolvedValue({ ...REVEAL, replacesFactor: true });
      await wrapper.get(byId('totp-replace')).trigger('click');
      await fillAndSubmitReauth(wrapper, '123456');

      expect(mocked.startTotpEnrollment).toHaveBeenCalledWith({
        password: 'hunter2',
        code: '123456',
      });
      expect(wrapper.get(byId('totp-replace-note')).text()).toContain('keeps working');
      wrapper.unmount();
    });

    it('cancels from the scan screen, wipes the secret and cancels on the server', async () => {
      const wrapper = await mountSection();
      await toScan(wrapper);
      mocked.getTotpFactor.mockResolvedValue(UNENROLLED);

      await wrapper.get(byId('totp-scan-cancel')).trigger('click');
      await flushPromises();

      expect(mocked.cancelTotpEnrollment).toHaveBeenCalledWith('enr-1');
      expect(wrapper.find(byId('totp-scan')).exists()).toBe(false);
      expect(wrapper.html()).not.toContain('JBSWY3DPEHPK3PXP');
      wrapper.unmount();
    });

    it('cancels from the password step with no request', async () => {
      const wrapper = await mountSection();
      await wrapper.get(byId('totp-enable')).trigger('click');
      await wrapper.get(byId('totp-password')).setValue('hunter2');

      await wrapper.get(byId('totp-reauth-cancel')).trigger('click');

      expect(wrapper.find(byId('totp-reauth-form')).exists()).toBe(false);
      expect(mocked.cancelTotpEnrollment).not.toHaveBeenCalled();
      wrapper.unmount();
    });
  });

  describe('proving yourself while a factor is active', () => {
    it('asks for a code with the one-time-code hints', async () => {
      const wrapper = await mountSection(ACTIVE);

      await wrapper.get(byId('totp-regenerate')).trigger('click');

      const proof = wrapper.get(byId('totp-proof'));
      expect(proof.attributes('autocomplete')).toBe('one-time-code');
      expect(proof.attributes('inputmode')).toBe('numeric');
      expect(wrapper.get(byId('totp-password')).attributes('autocomplete')).toBe(
        'current-password',
      );
      wrapper.unmount();
    });

    it('swaps to a recovery code field and back', async () => {
      const wrapper = await mountSection(ACTIVE);
      await wrapper.get(byId('totp-regenerate')).trigger('click');

      await wrapper.get(byId('totp-proof-mode')).trigger('click');
      const recovery = wrapper.get(byId('totp-proof'));
      expect(recovery.attributes('autocomplete')).toBe('off');
      expect(recovery.attributes('inputmode')).toBeUndefined();
      expect(wrapper.get(byId('totp-reauth-form')).text()).toContain('Recovery code');

      await wrapper.get(byId('totp-proof-mode')).trigger('click');
      expect(wrapper.get(byId('totp-proof')).attributes('inputmode')).toBe('numeric');
      wrapper.unmount();
    });

    it('strips a pasted spaced code to digits', async () => {
      const wrapper = await mountSection(ACTIVE);
      await wrapper.get(byId('totp-regenerate')).trigger('click');

      await wrapper.get(byId('totp-proof')).setValue('123 456');

      expect((wrapper.get(byId('totp-proof')).element as HTMLInputElement).value).toBe('123456');
      wrapper.unmount();
    });

    it('sends a recovery code as the proof', async () => {
      const wrapper = await mountSection(ACTIVE);
      mocked.replaceTotpRecoveryCodes.mockResolvedValue(CODES);
      await wrapper.get(byId('totp-regenerate')).trigger('click');
      await wrapper.get(byId('totp-proof-mode')).trigger('click');

      await fillAndSubmitReauth(wrapper, 'aaaa-bbbb');

      expect(mocked.replaceTotpRecoveryCodes).toHaveBeenCalledWith({
        password: 'hunter2',
        recoveryCode: 'aaaa-bbbb',
      });
      wrapper.unmount();
    });

    it.each([
      [failure(403), 'password or code'],
      [failure(423, undefined, 90), 'Try again in 2 minutes'],
      [failure(423, undefined, 20), 'Try again in 20 seconds'],
      [failure(423), 'Try again later'],
      [failure(429, undefined, 1), 'Another check is still running'],
      [failure(401), 'session ended'],
      [failure(400), 'Enter your password and a valid code'],
      [new TypeError('x'), "Couldn't reach the server"],
      [failure(500), 'Something went wrong'],
    ])('shows %s as a readable message and empties the secrets', async (error, text) => {
      const wrapper = await mountSection(ACTIVE);
      mocked.replaceTotpRecoveryCodes.mockRejectedValue(error);
      await wrapper.get(byId('totp-regenerate')).trigger('click');

      await fillAndSubmitReauth(wrapper, '123456');

      expect(wrapper.get(byId('totp-error')).text()).toContain(text);
      expect((wrapper.get(byId('totp-password')).element as HTMLInputElement).value).toBe('');
      expect((wrapper.get(byId('totp-proof')).element as HTMLInputElement).value).toBe('');
      wrapper.unmount();
    });

    it('disables the submit button while the check runs', async () => {
      const wrapper = await mountSection(ACTIVE);
      let release: (value: typeof CODES) => void = () => {};
      mocked.replaceTotpRecoveryCodes.mockReturnValue(
        new Promise((resolve) => (release = resolve)),
      );
      await wrapper.get(byId('totp-regenerate')).trigger('click');

      await fillAndSubmitReauth(wrapper, '123456');

      expect(wrapper.get(byId('totp-reauth-submit')).attributes('disabled')).toBeDefined();
      expect(wrapper.get(byId('totp-reauth-submit')).text()).toContain('Checking');
      release(CODES);
      await flushPromises();
      wrapper.unmount();
    });
  });

  describe('recovery codes', () => {
    it('shows each code once, after activation, with copy, download and a saved gate', async () => {
      const wrapper = await mountSection();

      await toCodes(wrapper);

      const list = wrapper.get(byId('totp-codes'));
      expect(list.findAll('li').map((item) => item.text())).toEqual(CODES.recoveryCodes);
      expect(wrapper.find(byId('totp-scan')).exists()).toBe(false);
      expect(wrapper.html()).not.toContain('JBSWY3DPEHPK3PXP');
      expect(wrapper.get(byId('totp-done')).attributes('disabled')).toBeDefined();
      wrapper.unmount();
    });

    it('copies the codes, one per line', async () => {
      const wrapper = await mountSection();
      await toCodes(wrapper);

      await wrapper.get(byId('totp-copy-codes')).trigger('click');
      await flushPromises();

      expect(mockWriteToClipboard).toHaveBeenCalledWith(
        'aaaa-bbbb\ncccc-dddd\neeee-ffff',
        'totp-codes',
      );
      wrapper.unmount();
    });

    it('downloads a text file of the codes', async () => {
      download.mockReturnValue(true);
      const wrapper = await mountSection();
      await toCodes(wrapper);

      await wrapper.get(byId('totp-download-codes')).trigger('click');

      expect(download).toHaveBeenCalledWith(
        'drydock-recovery-codes.txt',
        'Drydock recovery codes\n\naaaa-bbbb\ncccc-dddd\neeee-ffff\n',
      );
      expect(wrapper.find(byId('totp-error')).exists()).toBe(false);
      wrapper.unmount();
    });

    it('says so when the browser will not download', async () => {
      download.mockReturnValue(false);
      const wrapper = await mountSection();
      await toCodes(wrapper);

      await wrapper.get(byId('totp-download-codes')).trigger('click');

      expect(wrapper.get(byId('totp-codes-error')).text()).toContain('Copy them instead');
      wrapper.unmount();
    });

    it('only lets the person leave after ticking that they saved the codes', async () => {
      const wrapper = await mountSection();
      await toCodes(wrapper);

      await wrapper.get(byId('totp-saved')).setValue(true);
      expect(wrapper.get(byId('totp-done')).attributes('disabled')).toBeUndefined();
      mocked.getTotpFactor.mockResolvedValue(ACTIVE);
      await wrapper.get(byId('totp-done')).trigger('click');
      await flushPromises();

      expect(wrapper.find(byId('totp-codes')).exists()).toBe(false);
      expect(wrapper.get(byId('totp-notice')).text()).toContain('Two-factor authentication is on.');
      expect(wrapper.get(byId('totp-status')).text()).toContain('On since');
      expect(wrapper.html()).not.toContain('aaaa-bbbb');
      wrapper.unmount();
    });

    it('has no cancel button, so the show-once codes cannot be dropped by accident', async () => {
      const wrapper = await mountSection();
      await toCodes(wrapper);

      expect(wrapper.find(byId('totp-scan-cancel')).exists()).toBe(false);
      expect(wrapper.find(byId('totp-reauth-cancel')).exists()).toBe(false);
      wrapper.unmount();
    });

    it('stays on screen through an event-stream reconnect, a session refresh and a status re-read', async () => {
      const wrapper = await mountSection();
      await toCodes(wrapper);
      mocked.getTotpFactor.mockResolvedValue(ACTIVE);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
      globalThis.dispatchEvent(new CustomEvent('dd:sse-self-update'));
      document.dispatchEvent(new Event('visibilitychange'));
      globalThis.dispatchEvent(new Event('online'));
      await flushPromises();

      expect(wrapper.findAll(`${byId('totp-codes')} li`)).toHaveLength(3);
      wrapper.unmount();
    });

    it('regenerates codes and tells the person the old ones are dead', async () => {
      const wrapper = await mountSection(ACTIVE);
      mocked.replaceTotpRecoveryCodes.mockResolvedValue(CODES);
      await wrapper.get(byId('totp-regenerate')).trigger('click');
      await fillAndSubmitReauth(wrapper, '123456');
      expect(wrapper.findAll(`${byId('totp-codes')} li`)).toHaveLength(3);

      await wrapper.get(byId('totp-saved')).setValue(true);
      await wrapper.get(byId('totp-done')).trigger('click');
      await flushPromises();

      expect(wrapper.get(byId('totp-notice')).text()).toContain('old ones no longer work');
      wrapper.unmount();
    });
  });

  describe('removing', () => {
    it('asks for password and a code, then confirms in a dialog before sending anything', async () => {
      const wrapper = await mountSection(ACTIVE);
      mocked.removeTotpFactor.mockResolvedValue(undefined);
      await wrapper.get(byId('totp-remove')).trigger('click');

      await fillAndSubmitReauth(wrapper, '123456');

      const { visible, current } = useConfirmDialog();
      expect(visible.value).toBe(true);
      expect(current.value?.severity).toBe('danger');
      expect(current.value?.header).toContain('Turn off two-factor');
      expect(mocked.removeTotpFactor).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('sends nothing when the dialog is dismissed', async () => {
      const wrapper = await mountSection(ACTIVE);
      await wrapper.get(byId('totp-remove')).trigger('click');
      await fillAndSubmitReauth(wrapper, '123456');

      useConfirmDialog().dismiss();
      await flushPromises();

      expect(mocked.removeTotpFactor).not.toHaveBeenCalled();
      expect(wrapper.find(byId('totp-reauth-form')).exists()).toBe(true);
      wrapper.unmount();
    });

    it('removes the factor once confirmed and says it is off', async () => {
      const wrapper = await mountSection(ACTIVE);
      mocked.removeTotpFactor.mockResolvedValue(undefined);
      await wrapper.get(byId('totp-remove')).trigger('click');
      await fillAndSubmitReauth(wrapper, '123456');
      mocked.getTotpFactor.mockResolvedValue(UNENROLLED);

      await useConfirmDialog().accept();
      await flushPromises();

      expect(mocked.removeTotpFactor).toHaveBeenCalledWith({ password: 'hunter2', code: '123456' });
      expect(wrapper.get(byId('totp-notice')).text()).toContain(
        'Two-factor authentication is off.',
      );
      expect(wrapper.find(byId('totp-enable')).exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('secret hygiene', () => {
    it('never writes a secret to web storage, the URL or the console', async () => {
      const wrapper = await mountSection();
      const href = location.href;

      await toCodes(wrapper);
      await wrapper.get(byId('totp-saved')).setValue(true);
      await wrapper.get(byId('totp-done')).trigger('click');
      await flushPromises();

      const spies = [
        Storage.prototype.setItem,
        console.log,
        console.debug,
        console.info,
      ] as unknown as Array<ReturnType<typeof vi.fn>>;
      for (const spy of spies) {
        expect(JSON.stringify(spy.mock.calls)).not.toMatch(/hunter2|JBSWY3DPEHPK3PXP|aaaa-bbbb/);
      }
      expect(JSON.stringify(Object.entries(localStorage))).not.toMatch(
        /hunter2|JBSWY3DPEHPK3PXP|aaaa-bbbb/,
      );
      expect(JSON.stringify(Object.entries(sessionStorage))).not.toMatch(
        /hunter2|JBSWY3DPEHPK3PXP|aaaa-bbbb/,
      );
      expect(location.href).toBe(href);
      wrapper.unmount();
    });

    it('cancels a pending enrollment and wipes its secret when the section unmounts mid-scan', async () => {
      const wrapper = await mountSection();
      await toScan(wrapper);

      wrapper.unmount();

      expect(mocked.cancelTotpEnrollment).toHaveBeenCalledWith('enr-1');
      expect(document.body.innerHTML).not.toContain('JBSWY3DPEHPK3PXP');
    });

    it('does not cancel anything when it unmounts at rest', async () => {
      const wrapper = await mountSection(ACTIVE);

      wrapper.unmount();

      expect(mocked.cancelTotpEnrollment).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('labels every field and announces messages', async () => {
      const wrapper = await mountSection(ACTIVE);
      await wrapper.get(byId('totp-regenerate')).trigger('click');

      for (const id of ['totp-password', 'totp-proof']) {
        const field = wrapper.get(byId(id));
        const label = wrapper.find(`label[for="${field.attributes('id')}"]`);
        expect(label.exists()).toBe(true);
      }
      mocked.replaceTotpRecoveryCodes.mockRejectedValue(failure(403));
      await fillAndSubmitReauth(wrapper, '123456');
      expect(wrapper.get(byId('totp-error')).attributes('role')).toBe('alert');
      wrapper.unmount();
    });

    it('announces a notice politely', async () => {
      const wrapper = await mountSection(ACTIVE);
      mocked.removeTotpFactor.mockResolvedValue(undefined);
      await wrapper.get(byId('totp-remove')).trigger('click');
      await fillAndSubmitReauth(wrapper, '123456');
      mocked.getTotpFactor.mockResolvedValue(UNENROLLED);
      await useConfirmDialog().accept();
      await flushPromises();

      expect(wrapper.get(byId('totp-notice')).attributes('role')).toBe('status');
      wrapper.unmount();
    });

    it('gives the scan screen a labelled QR image and moves focus to the recovery heading', async () => {
      const wrapper = await mountSection();
      await toScan(wrapper);
      expect(wrapper.get('svg').attributes('aria-label')).toContain('QR code');

      mocked.confirmTotpEnrollment.mockResolvedValue(CODES);
      await wrapper.get(byId('totp-confirm-code')).setValue('123456');
      await wrapper.get(byId('totp-confirm-form')).trigger('submit');
      await flushPromises();

      expect(document.activeElement).toBe(wrapper.get(byId('totp-codes-heading')).element);
      wrapper.unmount();
    });
  });
});
