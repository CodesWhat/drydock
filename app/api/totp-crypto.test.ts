import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeHotp,
  decryptTotpSeed,
  digestRecoveryCode,
  encryptTotpSeed,
  findRecoveryCodeMatch,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSeed,
  loadTotpKeyringFromEnv,
  normalizeRecoveryCode,
  parseTotpKeyring,
  RECOVERY_CODE_COUNT,
  rewrapTotpSeed,
  TotpCryptoError,
  type TotpSeedBinding,
  totpCounterAt,
  totpSeedNeedsRewrap,
  verifyTotp,
} from './totp-crypto.js';

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

const binding: TotpSeedBinding = {
  subjectId: 'subject-1',
  rowId: 'factor-1',
  schemaVersion: 1,
  algorithm: 'SHA1',
  digits: 6,
  periodSeconds: 30,
  allowedSkewSteps: 1,
};

function key(fill: number): Buffer {
  return Buffer.alloc(32, fill);
}

function keyringJson(entries: Record<string, Buffer>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(entries).map(([id, value]) => [id, value.toString('base64')]),
    ),
  );
}

function ring(activeKeyId = 'k1', entries: Record<string, Buffer> = { k1: key(1) }) {
  return parseTotpKeyring(keyringJson(entries), activeKeyId);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RFC 6238 vectors (SHA-1)', () => {
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  test.each(vectors)('8 digits at T=%i is %s', (seconds, expected) => {
    expect(computeHotp(RFC_SECRET, totpCounterAt(seconds * 1000, 30), 8)).toBe(expected);
  });

  test.each(vectors)('6 digits at T=%i is the last six of %s', (seconds, expected) => {
    expect(generateTotp(RFC_SECRET, seconds * 1000)).toBe(expected.slice(2));
  });

  test('RFC 4226 HOTP counter vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676'];
    expect(expected.map((_, counter) => computeHotp(RFC_SECRET, counter, 6))).toEqual(expected);
  });

  test('rejects a negative or fractional counter', () => {
    expect(() => computeHotp(RFC_SECRET, -1, 6)).toThrow(TotpCryptoError);
    expect(() => computeHotp(RFC_SECRET, 1.5, 6)).toThrow(TotpCryptoError);
  });

  test('rejects an unsupported digit count', () => {
    expect(() => computeHotp(RFC_SECRET, 1, 5)).toThrow(TotpCryptoError);
    expect(() => computeHotp(RFC_SECRET, 1, 9)).toThrow(TotpCryptoError);
  });

  test('rejects an invalid clock or period', () => {
    expect(() => totpCounterAt(Number.NaN, 30)).toThrow(TotpCryptoError);
    expect(() => totpCounterAt(-1, 30)).toThrow(TotpCryptoError);
    expect(() => totpCounterAt(1000, 0)).toThrow(TotpCryptoError);
  });
});

describe('generateTotpSeed', () => {
  test('is 160 bits and different every call', () => {
    const first = generateTotpSeed();
    expect(first).toHaveLength(20);
    expect(generateTotpSeed().equals(first)).toBe(false);
  });
});

describe('verifyTotp', () => {
  const t0 = 1_700_000_000_000;
  const counter = totpCounterAt(t0, 30);
  const codeAt = (offset: number) => computeHotp(RFC_SECRET, counter + offset, 6);

  test('accepts the current step and reports its counter', () => {
    expect(verifyTotp({ secret: RFC_SECRET, code: codeAt(0), nowMs: t0 })).toEqual({
      valid: true,
      counter,
    });
  });

  test('accepts one step of drift in either direction', () => {
    expect(verifyTotp({ secret: RFC_SECRET, code: codeAt(-1), nowMs: t0 })).toEqual({
      valid: true,
      counter: counter - 1,
    });
    expect(verifyTotp({ secret: RFC_SECRET, code: codeAt(1), nowMs: t0 })).toEqual({
      valid: true,
      counter: counter + 1,
    });
  });

  test('rejects two steps of drift', () => {
    expect(verifyTotp({ secret: RFC_SECRET, code: codeAt(-2), nowMs: t0 }).valid).toBe(false);
    expect(verifyTotp({ secret: RFC_SECRET, code: codeAt(2), nowMs: t0 }).valid).toBe(false);
  });

  test('rolls over at the step boundary', () => {
    const boundary = (counter + 1) * 30_000;
    const justBefore = verifyTotp({ secret: RFC_SECRET, code: codeAt(0), nowMs: boundary - 1 });
    const atBoundary = verifyTotp({ secret: RFC_SECRET, code: codeAt(0), nowMs: boundary });
    expect(justBefore).toEqual({ valid: true, counter });
    expect(atBoundary).toEqual({ valid: true, counter });
    expect(generateTotp(RFC_SECRET, boundary - 1)).toBe(codeAt(0));
    expect(generateTotp(RFC_SECRET, boundary)).toBe(codeAt(1));
  });

  test('rejects a counter that was already accepted', () => {
    const result = verifyTotp({
      secret: RFC_SECRET,
      code: codeAt(0),
      nowMs: t0,
      lastAcceptedCounter: counter,
    });
    expect(result.valid).toBe(false);
  });

  test('rejects an older counter than the last accepted one', () => {
    expect(
      verifyTotp({
        secret: RFC_SECRET,
        code: codeAt(-1),
        nowMs: t0,
        lastAcceptedCounter: counter,
      }).valid,
    ).toBe(false);
  });

  test('accepts a newer counter after one was accepted', () => {
    expect(
      verifyTotp({
        secret: RFC_SECRET,
        code: codeAt(1),
        nowMs: t0,
        lastAcceptedCounter: counter,
      }),
    ).toEqual({ valid: true, counter: counter + 1 });
  });

  test('rejects after a clock rollback past the last accepted counter', () => {
    const rolledBackNow = t0 - 10 * 30_000;
    const rolledBackCode = computeHotp(RFC_SECRET, totpCounterAt(rolledBackNow, 30), 6);
    expect(
      verifyTotp({
        secret: RFC_SECRET,
        code: rolledBackCode,
        nowMs: rolledBackNow,
        lastAcceptedCounter: counter,
      }).valid,
    ).toBe(false);
  });

  test.each([
    ['empty', ''],
    ['short', '12345'],
    ['long', '1234567'],
    ['non-digit', 'abcdef'],
    ['spaced', '123 456'],
  ])('rejects a %s code', (_name, code) => {
    expect(verifyTotp({ secret: RFC_SECRET, code, nowMs: t0 }).valid).toBe(false);
  });

  test('rejects a non-string code', () => {
    expect(
      verifyTotp({ secret: RFC_SECRET, code: 123456 as unknown as string, nowMs: t0 }).valid,
    ).toBe(false);
  });

  test('rejects an unusable clock', () => {
    expect(verifyTotp({ secret: RFC_SECRET, code: codeAt(0), nowMs: Number.NaN }).valid).toBe(
      false,
    );
  });

  test('does not go below counter zero near the epoch', () => {
    expect(
      verifyTotp({ secret: RFC_SECRET, code: computeHotp(RFC_SECRET, 0, 6), nowMs: 0 }),
    ).toEqual({
      valid: true,
      counter: 0,
    });
  });

  test('compares every window regardless of where the match is', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    verifyTotp({ secret: RFC_SECRET, code: codeAt(-1), nowMs: t0 });
    const matchFirst = spy.mock.calls.length;
    spy.mockClear();
    verifyTotp({ secret: RFC_SECRET, code: '000000', nowMs: t0 });
    const noMatch = spy.mock.calls.length;
    spy.mockClear();
    verifyTotp({ secret: RFC_SECRET, code: 'x', nowMs: t0 });
    expect(matchFirst).toBe(3);
    expect(noMatch).toBe(3);
    expect(spy.mock.calls.length).toBe(3);
  });
});

describe('keyring', () => {
  test('parses base64 32-byte keys and the active id', () => {
    const parsed = ring('k2', { k1: key(1), k2: key(2) });
    expect(parsed.activeKeyId).toBe('k2');
    expect([...parsed.keys.keys()].sort()).toEqual(['k1', 'k2']);
    expect(parsed.keys.get('k2')?.equals(key(2))).toBe(true);
  });

  test.each([
    ['not JSON', 'nope', 'k1'],
    ['an array', '[]', 'k1'],
    ['null', 'null', 'k1'],
    ['empty', '{}', 'k1'],
    ['an invalid key id', JSON.stringify({ 'bad id': key(1).toString('base64') }), 'bad id'],
    ['a non-string key', JSON.stringify({ k1: 5 }), 'k1'],
    ['a short key', JSON.stringify({ k1: Buffer.alloc(16).toString('base64') }), 'k1'],
    ['a key that is not base64', JSON.stringify({ k1: '!!!not base64!!!' }), 'k1'],
    ['an unknown active id', keyringJson({ k1: key(1) }), 'k9'],
    ['no active id', keyringJson({ k1: key(1) }), ''],
  ])('rejects %s', (_name, json, active) => {
    expect(() => parseTotpKeyring(json, active)).toThrow(
      expect.objectContaining({ code: 'KEYRING_INVALID' }),
    );
  });

  test('a parse failure never echoes the file contents', () => {
    const secretLooking = `{"k1": "${key(7).toString('base64')}" oops`;
    try {
      parseTotpKeyring(secretLooking, 'k1');
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(key(7).toString('base64'));
      expect((error as Error).cause).toBeUndefined();
    }
  });

  describe('loadTotpKeyringFromEnv', () => {
    test('returns undefined when no key ring is configured', () => {
      expect(loadTotpKeyringFromEnv({}, vi.fn())).toBeUndefined();
    });

    test('reads the file named by DD_AUTH_TOTP_KEYRING__FILE', () => {
      const read = vi.fn(() => keyringJson({ k1: key(1) }));
      const loaded = loadTotpKeyringFromEnv(
        { DD_AUTH_TOTP_KEYRING__FILE: '/run/secrets/ring', DD_AUTH_TOTP_ACTIVE_KEY_ID: 'k1' },
        read,
      );
      expect(read).toHaveBeenCalledWith('/run/secrets/ring');
      expect(loaded?.activeKeyId).toBe('k1');
    });

    test('requires the active key id when a file is configured', () => {
      expect(() =>
        loadTotpKeyringFromEnv({ DD_AUTH_TOTP_KEYRING__FILE: '/run/secrets/ring' }, () =>
          keyringJson({ k1: key(1) }),
        ),
      ).toThrow(expect.objectContaining({ code: 'KEYRING_INVALID' }));
    });

    test('reports an unreadable file without leaking the OS error', () => {
      const read = vi.fn(() => {
        throw new Error('EACCES: permission denied, open /run/secrets/ring');
      });
      expect(() =>
        loadTotpKeyringFromEnv(
          { DD_AUTH_TOTP_KEYRING__FILE: '/run/secrets/ring', DD_AUTH_TOTP_ACTIVE_KEY_ID: 'k1' },
          read,
        ),
      ).toThrow(expect.objectContaining({ code: 'KEYRING_UNAVAILABLE' }));
    });

    test('an active key id with no file is a misconfiguration', () => {
      expect(() => loadTotpKeyringFromEnv({ DD_AUTH_TOTP_ACTIVE_KEY_ID: 'k1' }, vi.fn())).toThrow(
        expect.objectContaining({ code: 'KEYRING_UNAVAILABLE' }),
      );
    });

    test('defaults to process.env and the real filesystem', () => {
      expect(loadTotpKeyringFromEnv()).toBeUndefined();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-totp-ring-'));
      try {
        const file = path.join(dir, 'ring.json');
        fs.writeFileSync(file, keyringJson({ k1: key(1) }), { mode: 0o600 });
        const loaded = loadTotpKeyringFromEnv({
          DD_AUTH_TOTP_KEYRING__FILE: file,
          DD_AUTH_TOTP_ACTIVE_KEY_ID: 'k1',
        });
        expect(loaded?.keys.get('k1')?.equals(key(1))).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe('seed encryption (AES-256-GCM)', () => {
  const seed = Buffer.from('0123456789abcdef0123', 'ascii');

  test('round-trips and records the key id', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring());
    expect(encrypted.encryptionKeyId).toBe('k1');
    expect(decryptTotpSeed(encrypted, binding, ring()).equals(seed)).toBe(true);
  });

  test('stores base64 fields with a 96-bit nonce and 128-bit tag', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring());
    expect(Buffer.from(encrypted.secretNonce, 'base64')).toHaveLength(12);
    expect(Buffer.from(encrypted.secretAuthTag, 'base64')).toHaveLength(16);
    expect(Buffer.from(encrypted.secretCiphertext, 'base64')).toHaveLength(seed.length);
  });

  test('never contains the plaintext seed in any stored field', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring());
    const serialised = JSON.stringify(encrypted);
    expect(serialised).not.toContain(seed.toString('base64'));
    expect(serialised).not.toContain(seed.toString('latin1'));
    expect(Buffer.from(encrypted.secretCiphertext, 'base64').equals(seed)).toBe(false);
  });

  test('uses a fresh nonce every time', () => {
    const nonces = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      nonces.add(encryptTotpSeed(seed, binding, ring()).secretNonce);
    }
    expect(nonces.size).toBe(500);
  });

  test('uses the active key', () => {
    const multi = ring('k2', { k1: key(1), k2: key(2) });
    expect(encryptTotpSeed(seed, binding, multi).encryptionKeyId).toBe('k2');
  });

  test('fails with the wrong key', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring('k1', { k1: key(1) }));
    expect(() => decryptTotpSeed(encrypted, binding, ring('k1', { k1: key(9) }))).toThrow(
      expect.objectContaining({ code: 'DECRYPT_FAILED' }),
    );
  });

  test('fails with a missing key id', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring());
    expect(() => decryptTotpSeed(encrypted, binding, ring('k2', { k2: key(2) }))).toThrow(
      expect.objectContaining({ code: 'KEY_NOT_FOUND' }),
    );
  });

  test('fails when the recorded key id points at a different key', () => {
    const multi = ring('k1', { k1: key(1), k2: key(2) });
    const encrypted = encryptTotpSeed(seed, binding, multi);
    expect(() => decryptTotpSeed({ ...encrypted, encryptionKeyId: 'k2' }, binding, multi)).toThrow(
      expect.objectContaining({ code: 'DECRYPT_FAILED' }),
    );
  });

  test('fails with a tampered nonce', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring());
    const nonce = Buffer.from(encrypted.secretNonce, 'base64');
    nonce[0] ^= 1;
    expect(() =>
      decryptTotpSeed({ ...encrypted, secretNonce: nonce.toString('base64') }, binding, ring()),
    ).toThrow(expect.objectContaining({ code: 'DECRYPT_FAILED' }));
  });

  test('fails with a tampered tag', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring());
    const tag = Buffer.from(encrypted.secretAuthTag, 'base64');
    tag[0] ^= 1;
    expect(() =>
      decryptTotpSeed({ ...encrypted, secretAuthTag: tag.toString('base64') }, binding, ring()),
    ).toThrow(expect.objectContaining({ code: 'DECRYPT_FAILED' }));
  });

  test('fails with tampered ciphertext', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring());
    const body = Buffer.from(encrypted.secretCiphertext, 'base64');
    body[0] ^= 1;
    expect(() =>
      decryptTotpSeed({ ...encrypted, secretCiphertext: body.toString('base64') }, binding, ring()),
    ).toThrow(expect.objectContaining({ code: 'DECRYPT_FAILED' }));
  });

  test.each([
    ['nonce', { secretNonce: Buffer.alloc(8).toString('base64') }],
    ['tag', { secretAuthTag: Buffer.alloc(8).toString('base64') }],
  ])('fails with a wrong-length %s', (_name, override) => {
    const encrypted = encryptTotpSeed(seed, binding, ring());
    expect(() => decryptTotpSeed({ ...encrypted, ...override }, binding, ring())).toThrow(
      expect.objectContaining({ code: 'DECRYPT_FAILED' }),
    );
  });

  test.each([
    ['subject', { subjectId: 'subject-2' }],
    ['row id', { rowId: 'factor-2' }],
    ['schema version', { schemaVersion: 2 }],
    ['digits', { digits: 8 as const }],
    ['period', { periodSeconds: 60 }],
    ['skew', { allowedSkewSteps: 2 }],
  ])('fails when the bound %s differs (AAD)', (_name, override) => {
    const encrypted = encryptTotpSeed(seed, binding, ring());
    expect(() =>
      decryptTotpSeed(encrypted, { ...binding, ...override } as TotpSeedBinding, ring()),
    ).toThrow(expect.objectContaining({ code: 'DECRYPT_FAILED' }));
  });

  test('delimiter injection cannot make two bindings share AAD', () => {
    const encrypted = encryptTotpSeed(seed, { ...binding, subjectId: 'a', rowId: 'b|c' }, ring());
    expect(() =>
      decryptTotpSeed(encrypted, { ...binding, subjectId: 'a|b', rowId: 'c' }, ring()),
    ).toThrow(expect.objectContaining({ code: 'DECRYPT_FAILED' }));
  });

  test('error messages carry no key, seed or ciphertext', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring());
    try {
      decryptTotpSeed(encrypted, binding, ring('k1', { k1: key(9) }));
      expect.unreachable();
    } catch (error) {
      const text = `${(error as Error).message} ${(error as Error).stack ?? ''}`;
      expect(text).not.toContain(encrypted.secretCiphertext);
      expect(text).not.toContain(key(9).toString('base64'));
      expect(text).not.toContain(seed.toString('base64'));
      expect((error as Error).cause).toBeUndefined();
    }
  });

  test('the TotpCryptoError name is stable', () => {
    expect(new TotpCryptoError('DECRYPT_FAILED', 'x').name).toBe('TotpCryptoError');
  });
});

describe('rewrap', () => {
  const seed = generateTotpSeed();

  test('moves a seed from a retired key to the active key', () => {
    const before = ring('k1', { k1: key(1) });
    const encrypted = encryptTotpSeed(seed, binding, before);
    const after = ring('k2', { k1: key(1), k2: key(2) });
    expect(totpSeedNeedsRewrap(encrypted, after)).toBe(true);

    const rewrapped = rewrapTotpSeed(encrypted, binding, after);
    expect(rewrapped.encryptionKeyId).toBe('k2');
    expect(rewrapped.secretNonce).not.toBe(encrypted.secretNonce);
    expect(totpSeedNeedsRewrap(rewrapped, after)).toBe(false);
    expect(decryptTotpSeed(rewrapped, binding, after).equals(seed)).toBe(true);
  });

  test('the old key is no longer needed after a rewrap', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring('k1', { k1: key(1) }));
    const rewrapped = rewrapTotpSeed(encrypted, binding, ring('k2', { k1: key(1), k2: key(2) }));
    expect(decryptTotpSeed(rewrapped, binding, ring('k2', { k2: key(2) })).equals(seed)).toBe(true);
  });

  test('refuses to rewrap when the old key is gone', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring('k1', { k1: key(1) }));
    expect(() => rewrapTotpSeed(encrypted, binding, ring('k2', { k2: key(2) }))).toThrow(
      expect.objectContaining({ code: 'KEY_NOT_FOUND' }),
    );
  });

  test('refuses to rewrap under a different binding', () => {
    const encrypted = encryptTotpSeed(seed, binding, ring('k1', { k1: key(1) }));
    expect(() =>
      rewrapTotpSeed(
        encrypted,
        { ...binding, subjectId: 'other' },
        ring('k2', { k1: key(1), k2: key(2) }),
      ),
    ).toThrow(expect.objectContaining({ code: 'DECRYPT_FAILED' }));
  });
});

describe('recovery codes', () => {
  test('generates ten unique codes of at least 128 random bits', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(RECOVERY_CODE_COUNT).toBe(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      const normalized = normalizeRecoveryCode(code);
      expect(normalized).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  test('every generation is different', () => {
    const first = generateRecoveryCodes();
    const second = generateRecoveryCodes();
    expect(first.filter((code) => second.includes(code))).toEqual([]);
  });

  test('redraws a code that collides with an earlier one', () => {
    const repeated = Buffer.alloc(16, 0xab);
    const fresh = Buffer.alloc(16, 0xcd);
    const spy = vi
      .spyOn(crypto, 'randomBytes')
      .mockImplementationOnce(() => repeated)
      .mockImplementationOnce(() => repeated)
      .mockImplementationOnce(() => fresh);
    const codes = generateRecoveryCodes(2);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(new Set(codes).size).toBe(2);
  });

  test('rejects a nonsensical count', () => {
    expect(() => generateRecoveryCodes(0)).toThrow(TotpCryptoError);
    expect(() => generateRecoveryCodes(1.5)).toThrow(TotpCryptoError);
  });

  test('normalizes case, separators and whitespace', () => {
    const [code] = generateRecoveryCodes(1);
    expect(normalizeRecoveryCode(` ${code.toUpperCase()} `)).toBe(normalizeRecoveryCode(code));
    expect(normalizeRecoveryCode(code.replaceAll('-', ' '))).toBe(normalizeRecoveryCode(code));
  });

  test.each(['', 'short', 'g'.repeat(32), '0'.repeat(31), '0'.repeat(33)])(
    'does not normalize %j',
    (value) => {
      expect(normalizeRecoveryCode(value)).toBeNull();
    },
  );

  test('does not normalize a non-string', () => {
    expect(normalizeRecoveryCode(42 as unknown as string)).toBeNull();
  });

  test('digests are fixed-length, deterministic and not the code', () => {
    const [code] = generateRecoveryCodes(1);
    const digest = digestRecoveryCode(code);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digestRecoveryCode(code.toUpperCase())).toBe(digest);
    expect(digest).not.toContain(normalizeRecoveryCode(code));
  });

  test('digest of a malformed code throws', () => {
    expect(() => digestRecoveryCode('nope')).toThrow(TotpCryptoError);
  });

  describe('findRecoveryCodeMatch', () => {
    const codes = generateRecoveryCodes(4);
    const rows = codes.map((code, index) => ({
      codeId: `c${index}`,
      codeDigest: digestRecoveryCode(code),
      usedAt: null as string | null,
    }));

    test('finds the row for a valid unused code', () => {
      expect(findRecoveryCodeMatch(codes[2], rows)).toBe(rows[2]);
    });

    test('is case and separator tolerant', () => {
      expect(findRecoveryCodeMatch(codes[1].toUpperCase(), rows)).toBe(rows[1]);
    });

    test('does not match a used row', () => {
      const used = rows.map((row, index) => (index === 1 ? { ...row, usedAt: 'x' } : row));
      expect(findRecoveryCodeMatch(codes[1], used)).toBeUndefined();
    });

    test('does not match an unknown or malformed code', () => {
      expect(findRecoveryCodeMatch(generateRecoveryCodes(1)[0], rows)).toBeUndefined();
      expect(findRecoveryCodeMatch('garbage', rows)).toBeUndefined();
      expect(findRecoveryCodeMatch(undefined as unknown as string, rows)).toBeUndefined();
    });

    test('does the same comparisons whatever the outcome', () => {
      const spy = vi.spyOn(crypto, 'timingSafeEqual');
      findRecoveryCodeMatch(codes[0], rows);
      const first = spy.mock.calls.length;
      spy.mockClear();
      findRecoveryCodeMatch(codes[3], rows);
      const last = spy.mock.calls.length;
      spy.mockClear();
      findRecoveryCodeMatch(generateRecoveryCodes(1)[0], rows);
      const miss = spy.mock.calls.length;
      spy.mockClear();
      findRecoveryCodeMatch('garbage', rows);
      const malformed = spy.mock.calls.length;
      expect([first, last, miss, malformed]).toEqual([4, 4, 4, 4]);
    });

    test('with no rows there is nothing to match', () => {
      expect(findRecoveryCodeMatch(codes[0], [])).toBeUndefined();
    });
  });
});
