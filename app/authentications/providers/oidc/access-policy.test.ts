import {
  enforceOidcAccessPolicy,
  isOidcAccessPolicyConfigured,
  OidcAccessDeniedError,
} from './access-policy.js';

describe('enforceOidcAccessPolicy', () => {
  test('allows everyone when no option is set', () => {
    expect(() => enforceOidcAccessPolicy({}, {})).not.toThrow();
    expect(isOidcAccessPolicyConfigured({})).toBe(false);
    expect(isOidcAccessPolicyConfigured({ allowedemails: ' , ' })).toBe(false);
  });

  test('allows a listed email, case-insensitively', () => {
    const config = { allowedemails: 'Alice@Example.com, bob@example.com' };
    expect(() => enforceOidcAccessPolicy(config, { email: 'ALICE@example.COM' })).not.toThrow();
  });

  test('allows a listed domain, case-insensitively and with a leading at-sign', () => {
    const config = { allowedemaildomains: '@Example.com' };
    expect(() => enforceOidcAccessPolicy(config, { email: 'x@EXAMPLE.com' })).not.toThrow();
  });

  test('email and domain lists are alternatives', () => {
    const config = { allowedemails: 'a@one.test', allowedemaildomains: 'two.test' };
    expect(() => enforceOidcAccessPolicy(config, { email: 'a@one.test' })).not.toThrow();
    expect(() => enforceOidcAccessPolicy(config, { email: 'z@two.test' })).not.toThrow();
    expect(() => enforceOidcAccessPolicy(config, { email: 'z@three.test' })).toThrow(
      OidcAccessDeniedError,
    );
  });

  test('does not match subdomains or look-alike domains', () => {
    const config = { allowedemaildomains: 'example.com' };
    expect(() => enforceOidcAccessPolicy(config, { email: 'x@sub.example.com' })).toThrow();
    expect(() => enforceOidcAccessPolicy(config, { email: 'x@notexample.com' })).toThrow();
    expect(() => enforceOidcAccessPolicy(config, { email: 'x@example.com.evil.test' })).toThrow();
  });

  test('denies a missing or non-string email claim', () => {
    const config = { allowedemails: 'a@one.test' };
    expect(() => enforceOidcAccessPolicy(config, {})).toThrow('email claim is missing');
    expect(() => enforceOidcAccessPolicy(config, { email: 42 })).toThrow(OidcAccessDeniedError);
  });

  test('denies an unverified email but allows when email_verified is absent', () => {
    const config = { allowedemails: 'a@one.test' };
    expect(() =>
      enforceOidcAccessPolicy(config, { email: 'a@one.test', email_verified: false }),
    ).toThrow('email is not verified');
    expect(() =>
      enforceOidcAccessPolicy(config, { email: 'a@one.test', email_verified: 'false' }),
    ).toThrow('email is not verified');
    expect(() =>
      enforceOidcAccessPolicy(config, { email: 'a@one.test', email_verified: true }),
    ).not.toThrow();
    expect(() =>
      enforceOidcAccessPolicy(config, { email: 'a@one.test', email_verified: 'true' }),
    ).not.toThrow();
    expect(() => enforceOidcAccessPolicy(config, { email: 'a@one.test' })).not.toThrow();
  });

  test('does not require email_verified when only a group is required', () => {
    expect(() =>
      enforceOidcAccessPolicy(
        { requiredgroup: 'dd' },
        { groups: ['dd'], email: 'a@b.test', email_verified: false },
      ),
    ).not.toThrow();
  });

  test('required group accepts an array claim', () => {
    expect(() =>
      enforceOidcAccessPolicy({ requiredgroup: 'dd-admins' }, { groups: ['x', 'dd-admins'] }),
    ).not.toThrow();
    expect(() =>
      enforceOidcAccessPolicy({ requiredgroup: 'dd-admins' }, { groups: ['x', 'y'] }),
    ).toThrow('required group is missing');
  });

  test('required group accepts a string claim, comma or space separated', () => {
    expect(() =>
      enforceOidcAccessPolicy({ requiredgroup: 'dd' }, { groups: 'a, dd,b' }),
    ).not.toThrow();
    expect(() =>
      enforceOidcAccessPolicy({ requiredgroup: 'dd' }, { groups: 'a dd' }),
    ).not.toThrow();
    expect(() => enforceOidcAccessPolicy({ requiredgroup: 'dd' }, { groups: 'ddx' })).toThrow();
  });

  test('group matching is exact', () => {
    expect(() => enforceOidcAccessPolicy({ requiredgroup: 'dd' }, { groups: ['DD'] })).toThrow();
  });

  test('denies when the group claim is missing or the wrong type', () => {
    expect(() => enforceOidcAccessPolicy({ requiredgroup: 'dd' }, {})).toThrow(
      OidcAccessDeniedError,
    );
    expect(() => enforceOidcAccessPolicy({ requiredgroup: 'dd' }, { groups: 5 })).toThrow();
    expect(() =>
      enforceOidcAccessPolicy({ requiredgroup: 'dd' }, { groups: [{ name: 'dd' }] }),
    ).toThrow();
  });

  test('honours a custom claim name and ignores the default one', () => {
    const config = { requiredgroup: 'dd', groupclaim: 'roles' };
    expect(() => enforceOidcAccessPolicy(config, { roles: ['dd'] })).not.toThrow();
    expect(() => enforceOidcAccessPolicy(config, { groups: ['dd'] })).toThrow();
  });

  test('does not read inherited properties as the claim', () => {
    expect(() =>
      enforceOidcAccessPolicy({ requiredgroup: 'dd', groupclaim: 'constructor' }, {}),
    ).toThrow();
  });

  test('requires both the email check and the group when both are set', () => {
    const config = { allowedemaildomains: 'example.com', requiredgroup: 'dd' };
    expect(() =>
      enforceOidcAccessPolicy(config, { email: 'a@example.com', groups: ['dd'] }),
    ).not.toThrow();
    expect(() => enforceOidcAccessPolicy(config, { email: 'a@example.com', groups: [] })).toThrow();
    expect(() =>
      enforceOidcAccessPolicy(config, { email: 'a@evil.test', groups: ['dd'] }),
    ).toThrow();
  });

  test('denial messages never contain claim values', () => {
    try {
      enforceOidcAccessPolicy(
        { allowedemails: 'a@one.test' },
        { email: 'secret.person@private.test' },
      );
    } catch (error) {
      expect((error as Error).message).not.toContain('secret.person');
    }
  });
});
