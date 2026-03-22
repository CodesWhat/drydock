import { createHmac, timingSafeEqual } from 'node:crypto';

export interface RegistryWebhookSignatureVerification {
  valid: boolean;
  reason?: 'missing-secret' | 'missing-signature' | 'invalid-signature';
}

interface VerifyRegistryWebhookSignatureInput {
  payload: Buffer | string;
  secret: string;
  signature: string | undefined;
}

function normalizeSignature(signature: string | undefined): string | undefined {
  if (!signature) {
    return undefined;
  }

  const trimmed = signature.trim();
  if (trimmed === '') {
    return undefined;
  }

  const withoutPrefix = trimmed.toLowerCase().startsWith('sha256=')
    ? trimmed.slice('sha256='.length)
    : trimmed;
  return /^[a-f0-9]+$/i.test(withoutPrefix) ? withoutPrefix.toLowerCase() : undefined;
}

export function verifyRegistryWebhookSignature({
  payload,
  secret,
  signature,
}: VerifyRegistryWebhookSignatureInput): RegistryWebhookSignatureVerification {
  if (!secret) {
    return { valid: false, reason: 'missing-secret' };
  }

  const normalizedSignature = normalizeSignature(signature);
  if (!normalizedSignature) {
    return { valid: false, reason: 'missing-signature' };
  }

  const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');
  const receivedBuffer = Buffer.from(normalizedSignature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (receivedBuffer.length !== expectedBuffer.length) {
    return { valid: false, reason: 'invalid-signature' };
  }

  if (!timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return { valid: false, reason: 'invalid-signature' };
  }

  return { valid: true };
}
