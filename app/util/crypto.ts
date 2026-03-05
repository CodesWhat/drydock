import { createHash } from 'node:crypto';

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
