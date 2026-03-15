import { createHmac } from 'node:crypto';
import { verifyRegistryWebhookSignature } from './signature.js';

function signPayload(payload: Buffer, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

describe('verifyRegistryWebhookSignature', () => {
  test('returns valid=true for a correct signature', () => {
    const payload = Buffer.from('{"event":"push"}');
    const secret = 'super-secret';
    const signature = `sha256=${signPayload(payload, secret)}`;

    expect(
      verifyRegistryWebhookSignature({
        payload,
        secret,
        signature,
      }),
    ).toStrictEqual({ valid: true });
  });

  test('returns valid=false for an incorrect signature', () => {
    const payload = Buffer.from('{"event":"push"}');

    expect(
      verifyRegistryWebhookSignature({
        payload,
        secret: 'super-secret',
        signature: 'sha256=0000',
      }),
    ).toStrictEqual({ valid: false, reason: 'invalid-signature' });
  });

  test('returns missing-signature when signature is not provided', () => {
    const payload = Buffer.from('{"event":"push"}');

    expect(
      verifyRegistryWebhookSignature({
        payload,
        secret: 'super-secret',
        signature: undefined,
      }),
    ).toStrictEqual({ valid: false, reason: 'missing-signature' });
  });

  test('returns missing-secret when secret is not configured', () => {
    const payload = Buffer.from('{"event":"push"}');

    expect(
      verifyRegistryWebhookSignature({
        payload,
        secret: '',
        signature: 'sha256=abcd',
      }),
    ).toStrictEqual({ valid: false, reason: 'missing-secret' });
  });

  test('accepts raw hex signatures without the sha256= prefix', () => {
    const payload = Buffer.from('{"event":"push"}');
    const secret = 'super-secret';
    const signature = signPayload(payload, secret);

    expect(
      verifyRegistryWebhookSignature({
        payload,
        secret,
        signature,
      }),
    ).toStrictEqual({ valid: true });
  });
});
