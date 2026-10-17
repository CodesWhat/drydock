import { useTotpFactor } from '@/composables/useTotpFactor';
import * as service from '@/services/totp-factor';
import { TotpRequestError } from '@/services/totp-factor';

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

const mocked = vi.mocked(service);

const UNENROLLED = { status: 'unenrolled', recoveryCodesRemaining: 0 } as const;
const ACTIVE = {
  status: 'active',
  activatedAt: '2026-10-01T00:00:00.000Z',
  recoveryCodesRemaining: 10,
} as const;
const REVEAL = {
  id: 'enr-1',
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/Drydock:eve?secret=JBSWY3DPEHPK3PXP',
  expiresAt: '2026-10-01T00:10:00.000Z',
  replacesFactor: false,
};
const CODES = { recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'] };

function failure(status: number, reason?: string, retryAfter?: number) {
  return new TotpRequestError(`HTTP ${status}`, status, reason, retryAfter);
}

async function ready(status: service.TotpFactorStatus = UNENROLLED) {
  mocked.getTotpFactor.mockResolvedValue(status);
  const factor = useTotpFactor();
  await factor.load();
  return factor;
}

/** Walk an enable flow up to the scan screen. */
async function atScan(status: service.TotpFactorStatus = UNENROLLED, reveal = REVEAL) {
  const factor = await ready(status);
  mocked.startTotpEnrollment.mockResolvedValue(reveal);
  factor.begin(status.status === 'active' ? 'replace' : 'enable');
  factor.password.value = 'hunter2';
  if (status.status === 'active') {
    factor.proof.value = '123456';
  }
  await factor.submitReauth();
  return factor;
}

async function atCodes() {
  const factor = await atScan();
  mocked.confirmTotpEnrollment.mockResolvedValue(CODES);
  factor.confirmCode.value = '123456';
  await factor.confirm();
  return factor;
}

function expectNoSecrets(factor: ReturnType<typeof useTotpFactor>) {
  expect(factor.password.value).toBe('');
  expect(factor.proof.value).toBe('');
  expect(factor.confirmCode.value).toBe('');
  expect(factor.enrollment.value).toBeUndefined();
  expect(factor.recoveryCodes.value).toEqual([]);
  expect(factor.saved.value).toBe(false);
}

describe('useTotpFactor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.cancelTotpEnrollment.mockResolvedValue(undefined);
  });

  describe('load', () => {
    it('reports loading, then the status', async () => {
      mocked.getTotpFactor.mockResolvedValue(ACTIVE);
      const factor = useTotpFactor();
      expect(factor.loadState.value).toBe('loading');

      const loading = factor.load();
      await loading;

      expect(factor.loadState.value).toBe('ready');
      expect(factor.status.value).toEqual(ACTIVE);
      expect(factor.unavailable.value).toBeUndefined();
    });

    it('shows loading again on a hard reload but not on a silent one', async () => {
      const factor = await ready();
      let release: (value: service.TotpFactorStatus) => void = () => {};
      mocked.getTotpFactor.mockReturnValue(new Promise((resolve) => (release = resolve)));

      const silent = factor.load({ silent: true });
      expect(factor.loadState.value).toBe('ready');
      release(ACTIVE);
      await silent;
      expect(factor.status.value).toEqual(ACTIVE);

      mocked.getTotpFactor.mockReturnValue(new Promise((resolve) => (release = resolve)));
      const hard = factor.load();
      expect(factor.loadState.value).toBe('loading');
      release(UNENROLLED);
      await hard;
      expect(factor.loadState.value).toBe('ready');
    });

    it('treats a 403 as a non-local account', async () => {
      mocked.getTotpFactor.mockRejectedValue(failure(403));
      const factor = useTotpFactor();

      await factor.load();

      expect(factor.loadState.value).toBe('ready');
      expect(factor.status.value).toBeUndefined();
      expect(factor.unavailable.value).toBe('not-local');
    });

    it('treats a 403 from a mutation as a failed reauth, never a non-local account', async () => {
      const factor = await ready();
      mocked.startTotpEnrollment.mockRejectedValue(failure(403));
      factor.begin('enable');
      factor.password.value = 'wrong';

      await factor.submitReauth();

      expect(factor.unavailable.value).toBeUndefined();
      expect(factor.error.value).toEqual({ kind: 'reauth-failed' });
    });

    it.each([
      [401, 'session-ended'],
      [500, 'load'],
      [503, 'load'],
    ])('sends a %i to the error state', async (status, kind) => {
      mocked.getTotpFactor.mockRejectedValue(failure(status));
      const factor = useTotpFactor();

      await factor.load();

      expect(factor.loadState.value).toBe('error');
      expect(factor.loadError.value).toBe(kind);
    });

    it('calls a dead network a load failure', async () => {
      mocked.getTotpFactor.mockRejectedValue(new TypeError('Failed to fetch'));
      const factor = useTotpFactor();

      await factor.load();

      expect(factor.loadState.value).toBe('error');
      expect(factor.loadError.value).toBe('network');
    });

    it('calls a malformed response a load failure', async () => {
      mocked.getTotpFactor.mockRejectedValue(new Error('Unexpected two-factor response'));
      const factor = useTotpFactor();

      await factor.load();

      expect(factor.loadError.value).toBe('load');
    });

    it('retries from the error state', async () => {
      mocked.getTotpFactor.mockRejectedValueOnce(failure(500));
      const factor = useTotpFactor();
      await factor.load();
      mocked.getTotpFactor.mockResolvedValueOnce(UNENROLLED);

      await factor.load();

      expect(factor.loadState.value).toBe('ready');
      expect(factor.loadError.value).toBe('');
    });
  });

  describe('begin', () => {
    it('opens the reauth step with clean fields and no old messages', async () => {
      const factor = await ready(ACTIVE);
      factor.notice.value = 'removed';
      factor.error.value = { kind: 'generic' };

      factor.begin('replace');

      expect(factor.step.value).toBe('reauth');
      expect(factor.intent.value).toBe('replace');
      expect(factor.notice.value).toBeUndefined();
      expect(factor.error.value).toBeUndefined();
      expect(factor.needsProof.value).toBe(true);
      expect(factor.proofMode.value).toBe('code');
    });

    it('asks for a proof only while a factor is active', async () => {
      expect((await ready(UNENROLLED)).needsProof.value).toBe(false);
      expect((await ready(ACTIVE)).needsProof.value).toBe(true);
      expect(useTotpFactor().needsProof.value).toBe(false);
    });

    it('switches between code and recovery code and clears the proof', async () => {
      const factor = await ready(ACTIVE);
      factor.begin('remove');
      factor.proof.value = '123456';

      factor.setProofMode('recovery');
      expect(factor.proofMode.value).toBe('recovery');
      expect(factor.proof.value).toBe('');

      factor.proof.value = 'aaaa-bbbb';
      factor.setProofMode('code');
      expect(factor.proof.value).toBe('');
    });
  });

  describe('enable', () => {
    it('sends the password alone, keeps the seed in state and clears the password', async () => {
      const factor = await ready();
      mocked.startTotpEnrollment.mockResolvedValue(REVEAL);
      factor.begin('enable');
      factor.password.value = 'hunter2';

      await factor.submitReauth();

      expect(mocked.startTotpEnrollment).toHaveBeenCalledWith({ password: 'hunter2' });
      expect(factor.step.value).toBe('scan');
      expect(factor.enrollment.value).toEqual(REVEAL);
      expect(factor.password.value).toBe('');
      expect(factor.proof.value).toBe('');
      expect(factor.busy.value).toBe(false);
    });

    it('sends a replacement with the password and a spaced-out code stripped to digits', async () => {
      const factor = await ready(ACTIVE);
      mocked.startTotpEnrollment.mockResolvedValue({ ...REVEAL, replacesFactor: true });
      factor.begin('replace');
      factor.password.value = 'hunter2';
      factor.proof.value = '123 456';

      await factor.submitReauth();

      expect(mocked.startTotpEnrollment).toHaveBeenCalledWith({
        password: 'hunter2',
        code: '123456',
      });
      expect(factor.step.value).toBe('scan');
    });

    it('sends a recovery code, trimmed, as the one proof', async () => {
      const factor = await ready(ACTIVE);
      mocked.startTotpEnrollment.mockResolvedValue({ ...REVEAL, replacesFactor: true });
      factor.begin('replace');
      factor.setProofMode('recovery');
      factor.password.value = 'hunter2';
      factor.proof.value = '  aaaa-bbbb ';

      await factor.submitReauth();

      expect(mocked.startTotpEnrollment).toHaveBeenCalledWith({
        password: 'hunter2',
        recoveryCode: 'aaaa-bbbb',
      });
    });

    it.each([
      ['an empty password', '', '123456', 'code'],
      ['a short code', 'pw', '12345', 'code'],
      ['a code with letters', 'pw', '12345a', 'code'],
      ['an empty recovery code', 'pw', '   ', 'recovery'],
    ] as const)('refuses %s without calling the server', async (_label, password, proof, mode) => {
      const factor = await ready(ACTIVE);
      factor.begin('replace');
      factor.setProofMode(mode);
      factor.password.value = password;
      factor.proof.value = proof;

      await factor.submitReauth();

      expect(mocked.startTotpEnrollment).not.toHaveBeenCalled();
      expect(factor.step.value).toBe('reauth');
      expect(factor.error.value).toEqual({
        kind: password === '' ? 'invalid-request' : 'code-format',
      });
    });

    it('does nothing when no flow is open or a call is in flight', async () => {
      const factor = await ready();
      await factor.submitReauth();
      expect(mocked.startTotpEnrollment).not.toHaveBeenCalled();

      let release: (value: typeof REVEAL) => void = () => {};
      mocked.startTotpEnrollment.mockReturnValue(new Promise((resolve) => (release = resolve)));
      factor.begin('enable');
      factor.password.value = 'pw';
      const first = factor.submitReauth();
      expect(factor.busy.value).toBe(true);
      await factor.submitReauth();
      release(REVEAL);
      await first;

      expect(mocked.startTotpEnrollment).toHaveBeenCalledTimes(1);
    });

    it('also refuses a reauth step that has no intent', async () => {
      const factor = await ready();
      factor.step.value = 'reauth';
      factor.password.value = 'pw';

      await factor.submitReauth();

      expect(mocked.startTotpEnrollment).not.toHaveBeenCalled();
    });
  });

  describe('failures while proving yourself', () => {
    async function submitFailing(error: unknown, status: service.TotpFactorStatus = UNENROLLED) {
      const factor = await ready(status);
      mocked.startTotpEnrollment.mockRejectedValue(error);
      factor.begin('enable');
      factor.password.value = 'hunter2';
      factor.proof.value = '123456';
      await factor.submitReauth();
      return factor;
    }

    it.each([
      [failure(401), { kind: 'session-ended' }],
      [failure(403), { kind: 'reauth-failed' }],
      [failure(400), { kind: 'invalid-request' }],
      [failure(423, undefined, 90), { kind: 'locked', retryAfterSeconds: 90 }],
      [failure(423), { kind: 'locked' }],
      [failure(429, undefined, 1), { kind: 'busy', retryAfterSeconds: 1 }],
      [failure(404), { kind: 'not-active' }],
      [failure(409), { kind: 'state-changed' }],
      [failure(500), { kind: 'generic' }],
      [new TypeError('Failed to fetch'), { kind: 'network' }],
      [new Error('Unexpected two-factor response'), { kind: 'generic' }],
    ])('maps %s to %o and clears what was typed', async (error, expected) => {
      const factor = await submitFailing(error);

      expect(factor.error.value).toEqual(expected);
      expect(factor.password.value).toBe('');
      expect(factor.proof.value).toBe('');
      expect(factor.busy.value).toBe(false);
    });

    it('stays on the form for a wrong password so the person can try again', async () => {
      const factor = await submitFailing(failure(403));

      expect(factor.step.value).toBe('reauth');
    });

    it('returns to the start and re-reads the status when the state moved on', async () => {
      const factor = await ready();
      mocked.getTotpFactor.mockResolvedValue({
        ...UNENROLLED,
        pendingEnrollment: {
          id: 'x',
          expiresAt: '2026-10-01T00:10:00.000Z',
          replacesFactor: false,
        },
      });
      mocked.startTotpEnrollment.mockRejectedValue(failure(409));
      factor.begin('enable');
      factor.password.value = 'hunter2';
      await factor.submitReauth();

      expect(factor.step.value).toBe('idle');
      expect(factor.status.value?.pendingEnrollment?.id).toBe('x');
      expect(factor.error.value).toEqual({ kind: 'state-changed' });
    });

    it.each([
      [failure(403, 'https-required'), 'https-required'],
      [failure(403, 'recovery-assurance'), 'recovery-session'],
      [failure(503), 'no-key-ring'],
    ] as const)('turns %s into the %s unavailable state', async (error, reason) => {
      const factor = await submitFailing(error);

      expect(factor.unavailable.value).toBe(reason);
      expect(factor.error.value).toBeUndefined();
      expect(factor.step.value).toBe('idle');
      expectNoSecrets(factor);
    });

    it('keeps the unavailable state through a later status read', async () => {
      const factor = await submitFailing(failure(503));

      await factor.load({ silent: true });

      expect(factor.unavailable.value).toBe('no-key-ring');
    });
  });

  describe('scan and confirm', () => {
    it('confirms a six-digit code, drops the seed and shows the recovery codes', async () => {
      const factor = await atScan();
      mocked.confirmTotpEnrollment.mockResolvedValue(CODES);
      factor.confirmCode.value = '123 456';

      await factor.confirm();

      expect(mocked.confirmTotpEnrollment).toHaveBeenCalledWith('enr-1', '123456');
      expect(factor.step.value).toBe('codes');
      expect(factor.recoveryCodes.value).toEqual(CODES.recoveryCodes);
      expect(factor.enrollment.value).toBeUndefined();
      expect(factor.confirmCode.value).toBe('');
      expect(factor.saved.value).toBe(false);
    });

    it.each(['', '12345', '1234567', 'abcdef', '12 34 5', '１２３４５６'])(
      'never sends %j: any string burns one of five guesses',
      async (code) => {
        const factor = await atScan();
        factor.confirmCode.value = code;

        await factor.confirm();

        expect(mocked.confirmTotpEnrollment).not.toHaveBeenCalled();
        expect(factor.error.value).toEqual({ kind: 'code-format' });
        expect(factor.step.value).toBe('scan');
        expect(factor.enrollment.value).toEqual(REVEAL);
      },
    );

    it('keeps the scan screen on a wrong code and empties the field', async () => {
      const factor = await atScan();
      mocked.confirmTotpEnrollment.mockRejectedValue(failure(422));
      factor.confirmCode.value = '000000';

      await factor.confirm();

      expect(factor.error.value).toEqual({ kind: 'code-wrong' });
      expect(factor.step.value).toBe('scan');
      expect(factor.enrollment.value).toEqual(REVEAL);
      expect(factor.confirmCode.value).toBe('');
    });

    it.each([
      [410, 'enrollment-expired'],
      [404, 'enrollment-gone'],
      [409, 'state-changed'],
    ])('a %i ends the enrollment, wipes the seed and re-reads the status', async (status, kind) => {
      const factor = await atScan();
      mocked.confirmTotpEnrollment.mockRejectedValue(failure(status));
      mocked.getTotpFactor.mockClear();
      factor.confirmCode.value = '123456';

      await factor.confirm();

      expect(factor.error.value).toEqual({ kind });
      expect(factor.step.value).toBe('idle');
      expectNoSecrets(factor);
      expect(mocked.getTotpFactor).toHaveBeenCalledTimes(1);
    });

    it('handles other confirm failures like any request failure', async () => {
      const factor = await atScan();
      mocked.confirmTotpEnrollment.mockRejectedValue(failure(423, undefined, 30));
      factor.confirmCode.value = '123456';

      await factor.confirm();

      expect(factor.error.value).toEqual({ kind: 'locked', retryAfterSeconds: 30 });
      expect(factor.step.value).toBe('scan');
    });

    it('does nothing outside the scan step or while busy', async () => {
      const factor = await ready();
      factor.confirmCode.value = '123456';
      await factor.confirm();
      expect(mocked.confirmTotpEnrollment).not.toHaveBeenCalled();

      const scanning = await atScan();
      let release: (value: typeof CODES) => void = () => {};
      mocked.confirmTotpEnrollment.mockReturnValue(new Promise((resolve) => (release = resolve)));
      scanning.confirmCode.value = '123456';
      const first = scanning.confirm();
      await scanning.confirm();
      release(CODES);
      await first;
      expect(mocked.confirmTotpEnrollment).toHaveBeenCalledTimes(1);
    });

    it('cancels the pending enrollment and wipes everything', async () => {
      const factor = await atScan();
      factor.confirmCode.value = '12';
      mocked.getTotpFactor.mockClear();

      await factor.cancel();

      expect(mocked.cancelTotpEnrollment).toHaveBeenCalledWith('enr-1');
      expect(factor.step.value).toBe('idle');
      expectNoSecrets(factor);
      expect(mocked.getTotpFactor).toHaveBeenCalledTimes(1);
    });

    it('still closes the scan screen when the cancel call fails', async () => {
      const factor = await atScan();
      mocked.cancelTotpEnrollment.mockRejectedValue(failure(500));

      await factor.cancel();

      expect(factor.step.value).toBe('idle');
      expectNoSecrets(factor);
    });

    it('closes the reauth step without a request', async () => {
      const factor = await ready();
      factor.begin('enable');
      factor.password.value = 'hunter2';

      await factor.cancel();

      expect(mocked.cancelTotpEnrollment).not.toHaveBeenCalled();
      expect(factor.step.value).toBe('idle');
      expectNoSecrets(factor);
    });

    it('cannot be cancelled out of the recovery-codes screen', async () => {
      const factor = await atCodes();

      await factor.cancel();

      expect(factor.step.value).toBe('codes');
      expect(factor.recoveryCodes.value).toEqual(CODES.recoveryCodes);
    });
  });

  describe('recovery codes screen', () => {
    it('stays until the person says they saved the codes', async () => {
      const factor = await atCodes();
      mocked.getTotpFactor.mockClear();

      await factor.finish();

      expect(factor.step.value).toBe('codes');
      expect(factor.recoveryCodes.value).toEqual(CODES.recoveryCodes);
      expect(mocked.getTotpFactor).not.toHaveBeenCalled();
    });

    it('leaves, wipes the codes and reads the new status once saved', async () => {
      const factor = await atCodes();
      mocked.getTotpFactor.mockResolvedValue(ACTIVE);
      factor.saved.value = true;

      await factor.finish();

      expect(factor.step.value).toBe('idle');
      expectNoSecrets(factor);
      expect(factor.notice.value).toBe('enabled');
      expect(factor.status.value).toEqual(ACTIVE);
    });

    it('reports a replacement as replaced', async () => {
      const factor = await atScan(ACTIVE, { ...REVEAL, replacesFactor: true });
      mocked.confirmTotpEnrollment.mockResolvedValue(CODES);
      factor.confirmCode.value = '123456';
      await factor.confirm();
      factor.saved.value = true;

      await factor.finish();

      expect(factor.notice.value).toBe('replaced');
    });

    it('survives an event-stream reconnect, a refreshed session and a status re-read', async () => {
      const factor = await atCodes();
      mocked.getTotpFactor.mockResolvedValue(ACTIVE);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
      document.dispatchEvent(new Event('visibilitychange'));
      await factor.load({ silent: true });

      expect(factor.step.value).toBe('codes');
      expect(factor.recoveryCodes.value).toEqual(CODES.recoveryCodes);
    });

    it('ignores finish when it is not on that screen', async () => {
      const factor = await ready();
      factor.saved.value = true;
      mocked.getTotpFactor.mockClear();

      await factor.finish();

      expect(mocked.getTotpFactor).not.toHaveBeenCalled();
    });
  });

  describe('regenerate', () => {
    it('sends password plus a proof, then shows the new codes', async () => {
      const factor = await ready(ACTIVE);
      mocked.replaceTotpRecoveryCodes.mockResolvedValue(CODES);
      factor.begin('regenerate');
      factor.password.value = 'hunter2';
      factor.proof.value = '123456';

      await factor.submitReauth();

      expect(mocked.replaceTotpRecoveryCodes).toHaveBeenCalledWith({
        password: 'hunter2',
        code: '123456',
      });
      expect(factor.step.value).toBe('codes');
      expect(factor.recoveryCodes.value).toEqual(CODES.recoveryCodes);
      expect(factor.password.value).toBe('');
      factor.saved.value = true;
      await factor.finish();
      expect(factor.notice.value).toBe('regenerated');
    });

    it('turns a 404 into "not on" and re-reads the status', async () => {
      const factor = await ready(ACTIVE);
      mocked.replaceTotpRecoveryCodes.mockRejectedValue(failure(404));
      mocked.getTotpFactor.mockResolvedValue(UNENROLLED);
      factor.begin('regenerate');
      factor.password.value = 'hunter2';
      factor.proof.value = '123456';

      await factor.submitReauth();

      expect(factor.error.value).toEqual({ kind: 'not-active' });
      expect(factor.step.value).toBe('idle');
      expect(factor.status.value).toEqual(UNENROLLED);
    });
  });

  describe('remove', () => {
    it('sends password plus a recovery code, then reads the status', async () => {
      const factor = await ready(ACTIVE);
      mocked.removeTotpFactor.mockResolvedValue(undefined);
      mocked.getTotpFactor.mockResolvedValue(UNENROLLED);
      factor.begin('remove');
      factor.setProofMode('recovery');
      factor.password.value = 'hunter2';
      factor.proof.value = 'aaaa-bbbb';

      await factor.submitReauth();

      expect(mocked.removeTotpFactor).toHaveBeenCalledWith({
        password: 'hunter2',
        recoveryCode: 'aaaa-bbbb',
      });
      expect(factor.step.value).toBe('idle');
      expect(factor.notice.value).toBe('removed');
      expect(factor.status.value).toEqual(UNENROLLED);
      expectNoSecrets(factor);
    });
  });

  describe('a pending enrollment from the status', () => {
    const pending = {
      ...UNENROLLED,
      pendingEnrollment: {
        id: 'old',
        expiresAt: '2026-10-01T00:10:00.000Z',
        replacesFactor: false,
      },
    };

    it('can be cancelled by id and re-reads the status', async () => {
      const factor = await ready(pending);
      mocked.getTotpFactor.mockResolvedValue(UNENROLLED);

      await factor.cancelPending();

      expect(mocked.cancelTotpEnrollment).toHaveBeenCalledWith('old');
      expect(factor.status.value).toEqual(UNENROLLED);
      expect(factor.busy.value).toBe(false);
    });

    it('reports a failed cancel', async () => {
      const factor = await ready(pending);
      mocked.cancelTotpEnrollment.mockRejectedValue(failure(500));

      await factor.cancelPending();

      expect(factor.error.value).toEqual({ kind: 'generic' });
    });

    it('does nothing when nothing is pending or a call is in flight', async () => {
      const factor = await ready(UNENROLLED);
      await factor.cancelPending();
      expect(mocked.cancelTotpEnrollment).not.toHaveBeenCalled();

      const withPending = await ready(pending);
      let release: () => void = () => {};
      mocked.cancelTotpEnrollment.mockReturnValue(
        new Promise<void>((resolve) => (release = resolve)),
      );
      const first = withPending.cancelPending();
      await withPending.cancelPending();
      release();
      await first;
      expect(mocked.cancelTotpEnrollment).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('wipes everything and cancels an enrollment whose seed was shown', async () => {
      const factor = await atScan();
      factor.password.value = 'left-over';
      factor.confirmCode.value = '12';

      factor.dispose();

      expectNoSecrets(factor);
      expect(mocked.cancelTotpEnrollment).toHaveBeenCalledWith('enr-1');
    });

    it('does not complain when that cancel fails', async () => {
      const factor = await atScan();
      mocked.cancelTotpEnrollment.mockRejectedValue(failure(500));

      factor.dispose();
      await Promise.resolve();

      expectNoSecrets(factor);
    });

    it('wipes the recovery codes without cancelling anything', async () => {
      const factor = await atCodes();

      factor.dispose();

      expectNoSecrets(factor);
      expect(mocked.cancelTotpEnrollment).not.toHaveBeenCalled();
    });

    it('drops a reveal that arrives after it and cancels that enrollment', async () => {
      const factor = await ready();
      let release: (value: typeof REVEAL) => void = () => {};
      mocked.startTotpEnrollment.mockReturnValue(new Promise((resolve) => (release = resolve)));
      factor.begin('enable');
      factor.password.value = 'pw';
      const pendingCall = factor.submitReauth();

      factor.dispose();
      release(REVEAL);
      await pendingCall;

      expectNoSecrets(factor);
      expect(mocked.cancelTotpEnrollment).toHaveBeenCalledWith('enr-1');
    });

    it('drops recovery codes and errors that arrive after it', async () => {
      const factor = await ready(ACTIVE);
      let release: (value: typeof CODES) => void = () => {};
      mocked.replaceTotpRecoveryCodes.mockReturnValue(
        new Promise((resolve) => (release = resolve)),
      );
      factor.begin('regenerate');
      factor.password.value = 'pw';
      factor.proof.value = '123456';
      const pendingCall = factor.submitReauth();
      factor.dispose();
      release(CODES);
      await pendingCall;
      expectNoSecrets(factor);

      const failed = await ready(ACTIVE);
      let reject: (error: unknown) => void = () => {};
      mocked.removeTotpFactor.mockReturnValue(new Promise((_, r) => (reject = r)));
      failed.begin('remove');
      failed.password.value = 'pw';
      failed.proof.value = '123456';
      const failingCall = failed.submitReauth();
      failed.dispose();
      reject(failure(403));
      await failingCall;
      expect(failed.error.value).toBeUndefined();
    });

    it('drops a removal, a failed confirm and a failed status read that arrive after it', async () => {
      const removing = await ready(ACTIVE);
      let release: () => void = () => {};
      mocked.removeTotpFactor.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
      removing.begin('remove');
      removing.password.value = 'pw';
      removing.proof.value = '123456';
      const removal = removing.submitReauth();
      removing.dispose();
      release();
      await removal;
      expect(removing.notice.value).toBeUndefined();
      expect(mocked.getTotpFactor).toHaveBeenCalledTimes(1);

      const confirming = await atScan();
      let reject: (error: unknown) => void = () => {};
      mocked.confirmTotpEnrollment.mockReturnValue(new Promise((_, r) => (reject = r)));
      confirming.confirmCode.value = '123456';
      const confirmation = confirming.confirm();
      confirming.dispose();
      reject(failure(422));
      await confirmation;
      expect(confirming.error.value).toBeUndefined();

      const reading = await ready();
      let failRead: (error: unknown) => void = () => {};
      mocked.getTotpFactor.mockReturnValue(new Promise((_, r) => (failRead = r)));
      const read = reading.load({ silent: true });
      reading.dispose();
      failRead(failure(500));
      await read;
      expect(reading.loadState.value).toBe('ready');
    });

    it('does not complain when cancelling a late reveal fails', async () => {
      const factor = await ready();
      let release: (value: typeof REVEAL) => void = () => {};
      mocked.startTotpEnrollment.mockReturnValue(new Promise((resolve) => (release = resolve)));
      mocked.cancelTotpEnrollment.mockRejectedValue(failure(500));
      factor.begin('enable');
      factor.password.value = 'pw';
      const pendingCall = factor.submitReauth();
      factor.dispose();
      release(REVEAL);

      await expect(pendingCall).resolves.toBeUndefined();
    });

    it('drops a confirm result and a status read that arrive after it', async () => {
      const factor = await atScan();
      let release: (value: typeof CODES) => void = () => {};
      mocked.confirmTotpEnrollment.mockReturnValue(new Promise((resolve) => (release = resolve)));
      factor.confirmCode.value = '123456';
      const pendingCall = factor.confirm();
      factor.dispose();
      release(CODES);
      await pendingCall;
      expectNoSecrets(factor);

      const late = await ready();
      let readRelease: (value: service.TotpFactorStatus) => void = () => {};
      mocked.getTotpFactor.mockReturnValue(new Promise((resolve) => (readRelease = resolve)));
      const read = late.load({ silent: true });
      late.dispose();
      readRelease(ACTIVE);
      await read;
      expect(late.status.value).toEqual(UNENROLLED);
    });
  });
});
