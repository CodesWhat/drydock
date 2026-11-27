import { OidcAccessDeniedError } from './access-policy.js';
import {
  highestConfiguredOidcRole,
  isOidcRoleMappingConfigured,
  resolveOidcRole,
} from './role-mapping.js';

describe('isOidcRoleMappingConfigured', () => {
  test.each([
    [{}, false],
    [{ admingroup: '  ', operatorgroup: ',' }, false],
    [{ admingroup: 'a' }, true],
    [{ viewergroup: 'v' }, true],
    [{ defaultrole: 'viewer' as const }, true],
  ])('%j -> %s', (configuration, expected) => {
    expect(isOidcRoleMappingConfigured(configuration)).toBe(expected);
  });
});

describe('highestConfiguredOidcRole', () => {
  test('is admin with nothing mapped', () => {
    expect(highestConfiguredOidcRole({})).toBe('admin');
  });

  test('is the highest mapped group role', () => {
    expect(highestConfiguredOidcRole({ operatorgroup: 'o', viewergroup: 'v' })).toBe('operator');
  });

  test('counts the unmatched default, viewer unless set', () => {
    expect(highestConfiguredOidcRole({ operatorgroup: 'o', defaultrole: 'admin' })).toBe('admin');
    expect(highestConfiguredOidcRole({ defaultrole: 'viewer' })).toBe('viewer');
  });

  test('is undefined when only none is configured', () => {
    expect(highestConfiguredOidcRole({ defaultrole: 'none' })).toBeUndefined();
  });
});

describe('resolveOidcRole', () => {
  test('is undefined when nothing is mapped', () => {
    expect(resolveOidcRole({}, { groups: ['x'] })).toBeUndefined();
  });

  test('ignores a prototype property named like the claim', () => {
    expect(resolveOidcRole({ admingroup: 'a', groupclaim: 'toString' }, {})).toBe('viewer');
  });

  test('defaults the claim name when groupclaim is blank', () => {
    expect(resolveOidcRole({ admingroup: 'a', groupclaim: ' ' }, { groups: ['a'] })).toBe('admin');
  });

  test('throws the access-denied error for none', () => {
    expect(() => resolveOidcRole({ admingroup: 'a', defaultrole: 'none' }, {})).toThrow(
      OidcAccessDeniedError,
    );
  });

  test('an explicit admin default applies without groups', () => {
    expect(resolveOidcRole({ defaultrole: 'admin' }, {})).toBe('admin');
  });
});
