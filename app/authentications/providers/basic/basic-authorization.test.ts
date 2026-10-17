import {
  getBasicAuthorizationFailureStatus,
  parseBasicAuthorization,
} from './basic-authorization.js';

function encode(value: string): string {
  return Buffer.from(value).toString('base64');
}

describe('parseBasicAuthorization', () => {
  test('reads a well-formed header', () => {
    expect(parseBasicAuthorization(`Basic ${encode('alice:secret')}`)).toEqual({
      outcome: 'credentials',
      userid: 'alice',
      password: 'secret',
    });
  });

  test('accepts any casing of the scheme', () => {
    expect(parseBasicAuthorization(`bAsIc ${encode('alice:secret')}`)).toEqual({
      outcome: 'credentials',
      userid: 'alice',
      password: 'secret',
    });
  });

  test.each([
    ['no header at all', undefined],
    ['an empty header', ''],
    ['a non-string header', ['Basic abc']],
  ])('reports %s as absent', (_case, header) => {
    expect(parseBasicAuthorization(header)).toEqual({ outcome: 'absent' });
  });

  test('reports another scheme as absent', () => {
    expect(parseBasicAuthorization('Bearer abcdef')).toEqual({ outcome: 'absent' });
  });

  test('reports an empty userid as absent', () => {
    expect(parseBasicAuthorization(`Basic ${encode(':secret')}`)).toEqual({ outcome: 'absent' });
  });

  test('reports an empty password as absent', () => {
    expect(parseBasicAuthorization(`Basic ${encode('alice:')}`)).toEqual({ outcome: 'absent' });
  });

  test('reports a single-token header as malformed, whatever the scheme', () => {
    expect(parseBasicAuthorization('Basic')).toEqual({ outcome: 'malformed' });
    expect(parseBasicAuthorization('Bearer')).toEqual({ outcome: 'malformed' });
  });

  test('reports a credential with no colon as malformed', () => {
    expect(parseBasicAuthorization(`Basic ${encode('alicesecret')}`)).toEqual({
      outcome: 'malformed',
    });
  });

  test('reports an empty credential as malformed', () => {
    expect(parseBasicAuthorization('Basic ')).toEqual({ outcome: 'malformed' });
  });

  test('truncates a password at its first colon, as passport-http did', () => {
    expect(parseBasicAuthorization(`Basic ${encode('alice:sec:ret')}`)).toEqual({
      outcome: 'credentials',
      userid: 'alice',
      password: 'sec',
    });
  });
});

describe('getBasicAuthorizationFailureStatus', () => {
  test('asks for 400 on a syntactically broken header', () => {
    expect(getBasicAuthorizationFailureStatus('Basic')).toBe(400);
  });

  test('leaves the chain on its default for a missing header', () => {
    expect(getBasicAuthorizationFailureStatus(undefined)).toBeUndefined();
  });

  test('leaves the chain on its default for a valid header', () => {
    expect(getBasicAuthorizationFailureStatus(`Basic ${encode('alice:secret')}`)).toBeUndefined();
  });
});
