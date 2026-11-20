import type { Request, Response } from 'express';
import { getAuditActor } from '../store/audit-actor.js';
import { bindAuditActor, getAuditActorForRequest } from './audit-actor.js';
import type { AuthenticatedPrincipal } from './principal.js';

const identity = { subjectId: 's', providerId: 'basic.one', assurance: 'password', issuedAt: 1 };
const req = (principal?: unknown) => ({ principal }) as unknown as Request;

describe('getAuditActorForRequest', () => {
  test.each<[string, AuthenticatedPrincipal | undefined, string | undefined]>([
    ['no principal', undefined, undefined],
    ['a session', { kind: 'session', username: ' alice ' }, 'alice'],
    ['basic auth', { kind: 'basic', username: 'bob', identity } as never, 'bob'],
    ['oidc', { kind: 'oidc', username: 'carol@example.com' }, 'carol@example.com'],
    ['anonymous', { kind: 'anonymous', username: 'anonymous' }, 'anonymous'],
    [
      'an api key',
      { kind: 'api-key', username: 'ci', keyId: 'k1', scopes: [], parentKeyId: null },
      'api-key:ci',
    ],
    [
      'an api key with a blank name',
      { kind: 'api-key', username: '  ', keyId: 'k2', scopes: [], parentKeyId: null },
      'api-key:k2',
    ],
    ['a blank username', { kind: 'session', username: '   ' }, undefined],
  ])('names the actor for %s', (_label, principal, expected) => {
    expect(getAuditActorForRequest(req(principal))).toBe(expected);
  });

  test('truncates an overlong username', () => {
    expect(
      getAuditActorForRequest(req({ kind: 'session', username: 'x'.repeat(500) })),
    ).toHaveLength(200);
  });
});

describe('bindAuditActor', () => {
  test('binds the actor for the rest of the request, including async continuations', async () => {
    let seen: string | undefined;
    const next = vi.fn(async () => {
      await Promise.resolve();
      seen = getAuditActor();
    });
    bindAuditActor(req({ kind: 'session', username: 'alice' }), {} as Response, next);
    await vi.waitFor(() => expect(seen).toBe('alice'));
    expect(getAuditActor()).toBeUndefined();
  });

  test('leaves the actor unset for an unauthenticated request', () => {
    let seen: string | undefined = 'unset';
    const next = vi.fn(() => {
      seen = getAuditActor();
    });
    bindAuditActor(req(), {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(seen).toBeUndefined();
  });
});
