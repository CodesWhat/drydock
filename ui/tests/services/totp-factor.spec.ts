import {
  cancelTotpEnrollment,
  confirmTotpEnrollment,
  getTotpFactor,
  removeTotpFactor,
  replaceTotpRecoveryCodes,
  startTotpEnrollment,
  TotpRequestError,
} from '@/services/totp-factor';

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function reply(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => {
      if (body === undefined) {
        throw new SyntaxError('no body');
      }
      return body;
    },
  };
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
}

describe('totp-factor service', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  describe('getTotpFactor', () => {
    it('reads an unenrolled status', async () => {
      fetchMock.mockResolvedValueOnce(
        reply(200, { status: 'unenrolled', recoveryCodesRemaining: 0 }),
      );

      await expect(getTotpFactor()).resolves.toEqual({
        status: 'unenrolled',
        recoveryCodesRemaining: 0,
      });
      const { url, init } = lastCall();
      expect(url).toBe('/api/v1/auth/totp-factor');
      expect(init.credentials).toBe('include');
      expect(init.method).toBeUndefined();
    });

    it('reads an active status with a pending replacement', async () => {
      fetchMock.mockResolvedValueOnce(
        reply(200, {
          status: 'active',
          activatedAt: '2026-10-01T00:00:00.000Z',
          recoveryCodesRemaining: 7,
          pendingEnrollment: {
            id: 'e1',
            expiresAt: '2026-10-01T00:10:00.000Z',
            replacesFactor: true,
          },
        }),
      );

      await expect(getTotpFactor()).resolves.toEqual({
        status: 'active',
        activatedAt: '2026-10-01T00:00:00.000Z',
        recoveryCodesRemaining: 7,
        pendingEnrollment: {
          id: 'e1',
          expiresAt: '2026-10-01T00:10:00.000Z',
          replacesFactor: true,
        },
      });
    });

    it.each([
      ['not an object', 'nope'],
      ['null', null],
      ['an unknown status', { status: 'weird', recoveryCodesRemaining: 0 }],
      ['no count', { status: 'active' }],
      ['an active status with no date', { status: 'active', recoveryCodesRemaining: 1 }],
      [
        'a malformed pending enrollment',
        { status: 'unenrolled', recoveryCodesRemaining: 0, pendingEnrollment: { id: 4 } },
      ],
    ])('rejects a response that is %s', async (_label, body) => {
      fetchMock.mockResolvedValueOnce(reply(200, body));

      await expect(getTotpFactor()).rejects.toThrow('Unexpected two-factor response');
    });
  });

  describe('startTotpEnrollment', () => {
    const reveal = {
      id: 'e1',
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/Drydock:eve?secret=JBSWY3DPEHPK3PXP',
      expiresAt: '2026-10-01T00:10:00.000Z',
      replacesFactor: false,
    };

    it('posts the password and returns the reveal', async () => {
      fetchMock.mockResolvedValueOnce(reply(201, reveal));

      await expect(startTotpEnrollment({ password: 'pw' })).resolves.toEqual(reveal);
      const { url, init, body } = lastCall();
      expect(url).toBe('/api/v1/auth/totp-enrollments');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(body).toEqual({ password: 'pw' });
    });

    it('sends exactly one proof when a factor is active', async () => {
      fetchMock.mockResolvedValue(reply(201, reveal));

      await startTotpEnrollment({ password: 'pw', code: '123456' });
      expect(lastCall().body).toEqual({ password: 'pw', code: '123456' });

      await startTotpEnrollment({ password: 'pw', recoveryCode: 'abcd-efgh' });
      expect(lastCall().body).toEqual({ password: 'pw', recoveryCode: 'abcd-efgh' });
    });

    it.each([
      ['no body', undefined],
      ['no secret', { id: 'e1' }],
      ['a non-boolean replace flag', { ...reveal, replacesFactor: 'no' }],
    ])('rejects a reveal with %s', async (_label, body) => {
      fetchMock.mockResolvedValueOnce(reply(201, body));

      await expect(startTotpEnrollment({ password: 'pw' })).rejects.toThrow(
        'Unexpected two-factor response',
      );
    });
  });

  describe('confirmTotpEnrollment', () => {
    it('puts the code and returns the recovery codes', async () => {
      fetchMock.mockResolvedValueOnce(
        reply(201, {
          status: 'active',
          activatedAt: '2026-10-01T00:00:00.000Z',
          recoveryCodesRemaining: 2,
          recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'],
        }),
      );

      await expect(confirmTotpEnrollment('e/1', '123456')).resolves.toEqual({
        recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'],
      });
      const { url, init, body } = lastCall();
      expect(url).toBe('/api/v1/auth/totp-enrollments/e%2F1');
      expect(init.method).toBe('PUT');
      expect(body).toEqual({ code: '123456' });
    });

    it.each([
      ['no body', undefined],
      ['no codes', { status: 'active' }],
      ['a non-string code', { recoveryCodes: ['ok', 3] }],
      ['an empty set', { recoveryCodes: [] }],
    ])('rejects a response with %s', async (_label, body) => {
      fetchMock.mockResolvedValueOnce(reply(201, body));

      await expect(confirmTotpEnrollment('e1', '123456')).rejects.toThrow(
        'Unexpected two-factor response',
      );
    });
  });

  describe('cancelTotpEnrollment', () => {
    it('deletes the enrollment', async () => {
      fetchMock.mockResolvedValueOnce(reply(204));

      await expect(cancelTotpEnrollment('e1')).resolves.toBeUndefined();
      const { url, init } = lastCall();
      expect(url).toBe('/api/v1/auth/totp-enrollments/e1');
      expect(init.method).toBe('DELETE');
      expect(init.body).toBeUndefined();
    });
  });

  describe('replaceTotpRecoveryCodes', () => {
    it('posts the reauth and returns the new codes', async () => {
      fetchMock.mockResolvedValueOnce(
        reply(201, { recoveryCodes: ['aaaa-bbbb'], recoveryCodesRemaining: 1 }),
      );

      await expect(replaceTotpRecoveryCodes({ password: 'pw', code: '123456' })).resolves.toEqual({
        recoveryCodes: ['aaaa-bbbb'],
      });
      const { url, init, body } = lastCall();
      expect(url).toBe('/api/v1/auth/totp-recovery-code-sets');
      expect(init.method).toBe('POST');
      expect(body).toEqual({ password: 'pw', code: '123456' });
    });
  });

  describe('removeTotpFactor', () => {
    it('deletes with a JSON body', async () => {
      fetchMock.mockResolvedValueOnce(reply(204));

      await expect(
        removeTotpFactor({ password: 'pw', recoveryCode: 'aaaa-bbbb' }),
      ).resolves.toBeUndefined();
      const { url, init, body } = lastCall();
      expect(url).toBe('/api/v1/auth/totp-factor');
      expect(init.method).toBe('DELETE');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(body).toEqual({ password: 'pw', recoveryCode: 'aaaa-bbbb' });
    });
  });

  describe('errors', () => {
    it('keeps the status, server message and reason', async () => {
      fetchMock.mockResolvedValueOnce(
        reply(403, {
          error: 'Two-factor management requires HTTPS',
          details: { reason: 'https-required' },
        }),
      );

      const error = await startTotpEnrollment({ password: 'pw' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TotpRequestError);
      expect(error).toMatchObject({
        name: 'TotpRequestError',
        status: 403,
        reason: 'https-required',
        message: 'Two-factor management requires HTTPS',
        retryAfterSeconds: undefined,
      });
    });

    it('reads Retry-After in seconds', async () => {
      fetchMock.mockResolvedValueOnce(reply(423, { error: 'Locked' }, { 'Retry-After': '90' }));

      await expect(removeTotpFactor({ password: 'pw' })).rejects.toMatchObject({
        status: 423,
        retryAfterSeconds: 90,
      });
    });

    it.each([
      ['a date', 'Wed, 21 Oct 2026 07:28:00 GMT'],
      ['junk', 'soon'],
    ])('ignores a Retry-After that is %s', async (_label, value) => {
      fetchMock.mockResolvedValueOnce(reply(429, { error: 'Busy' }, { 'Retry-After': value }));

      await expect(removeTotpFactor({ password: 'pw' })).rejects.toMatchObject({
        status: 429,
        retryAfterSeconds: undefined,
      });
    });

    it('falls back to the status when the body has no usable message', async () => {
      fetchMock.mockResolvedValueOnce(reply(500, undefined));
      await expect(getTotpFactor()).rejects.toMatchObject({
        status: 500,
        message: 'Two-factor request failed (500)',
        reason: undefined,
      });

      fetchMock.mockResolvedValueOnce(reply(500, { error: '  ', details: 'oops' }));
      await expect(getTotpFactor()).rejects.toMatchObject({
        message: 'Two-factor request failed (500)',
        reason: undefined,
      });

      fetchMock.mockResolvedValueOnce(reply(500, 'plain'));
      await expect(getTotpFactor()).rejects.toMatchObject({ status: 500 });

      fetchMock.mockResolvedValueOnce(reply(500, { error: 'x', details: { reason: 4 } }));
      await expect(getTotpFactor()).rejects.toMatchObject({ reason: undefined });
    });

    it('lets a network failure through untouched', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(getTotpFactor()).rejects.toThrow('Failed to fetch');
    });

    it('works with a response that has no headers object', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Busy' }),
      });

      await expect(getTotpFactor()).rejects.toMatchObject({
        status: 429,
        retryAfterSeconds: undefined,
      });
    });
  });
});
