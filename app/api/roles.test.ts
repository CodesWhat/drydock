import {
  DEFAULT_ROLE,
  hasRoleScope,
  isRole,
  lowerRole,
  minRoleForScope,
  parseRole,
  ROLE_SCOPES,
  ROLES,
  roleAtLeast,
} from './roles.js';
import { API_SCOPES, type ApiScope } from './route-scopes.js';

describe('role vocabulary', () => {
  test('ships three roles, least to most', () => {
    expect(ROLES).toStrictEqual(['viewer', 'operator', 'admin']);
  });

  test('defaults to admin, which is what every human was before roles', () => {
    expect(DEFAULT_ROLE).toBe('admin');
  });

  test('admin holds every scope the API enforces, key management included', () => {
    expect([...ROLE_SCOPES.admin].sort()).toStrictEqual([...API_SCOPES].sort());
  });

  test('every role scope is a real scope', () => {
    for (const role of ROLES) {
      for (const scope of ROLE_SCOPES[role]) {
        expect(API_SCOPES as readonly string[]).toContain(scope);
      }
    }
  });

  test('each role holds everything the role below it does', () => {
    for (let index = 1; index < ROLES.length; index += 1) {
      for (const scope of ROLE_SCOPES[ROLES[index - 1]]) {
        expect(ROLE_SCOPES[ROLES[index]]).toContain(scope);
      }
    }
  });

  test('viewer reads, operator runs updates and restarts, neither administers', () => {
    expect(ROLE_SCOPES.viewer).toStrictEqual(['read']);
    expect(ROLE_SCOPES.operator).toStrictEqual([
      'read',
      'containers:watch',
      'containers:update',
      'containers:control',
      'triggers:test',
    ]);
    expect(hasRoleScope('operator', 'admin')).toBe(false);
    expect(hasRoleScope('operator', 'api-keys:manage')).toBe(false);
  });
});

describe('isRole', () => {
  test.each(ROLES)('accepts %s', (role) => {
    expect(isRole(role)).toBe(true);
  });

  test.each(['Admin', 'root', '', undefined, 3])('rejects %j', (value) => {
    expect(isRole(value)).toBe(false);
  });
});

describe('parseRole', () => {
  test('treats absent and blank as not configured', () => {
    expect(parseRole(undefined, 'DD_X')).toBeUndefined();
    expect(parseRole('   ', 'DD_X')).toBeUndefined();
  });

  test('trims and lowercases', () => {
    expect(parseRole(' Viewer ', 'DD_X')).toBe('viewer');
  });

  test('throws on anything else, naming the variable', () => {
    expect(() => parseRole('root', 'DD_ANONYMOUS_AUTH_ROLE')).toThrow(
      'DD_ANONYMOUS_AUTH_ROLE must be one of viewer, operator, admin (got "root")',
    );
  });
});

describe('role ordering', () => {
  test('roleAtLeast compares authority', () => {
    expect(roleAtLeast('admin', 'viewer')).toBe(true);
    expect(roleAtLeast('operator', 'operator')).toBe(true);
    expect(roleAtLeast('viewer', 'operator')).toBe(false);
    expect(roleAtLeast('operator', 'admin')).toBe(false);
  });

  test('lowerRole picks the one granting less, either way round', () => {
    expect(lowerRole('admin', 'viewer')).toBe('viewer');
    expect(lowerRole('viewer', 'admin')).toBe('viewer');
    expect(lowerRole('operator', 'operator')).toBe('operator');
  });
});

describe('minRoleForScope', () => {
  test.each([
    ['read', 'viewer'],
    ['containers:watch', 'operator'],
    ['containers:update', 'operator'],
    ['containers:control', 'operator'],
    ['triggers:test', 'operator'],
    ['admin', 'admin'],
    ['api-keys:manage', 'admin'],
  ] as const)('%s needs %s', (scope, role) => {
    expect(minRoleForScope(scope)).toBe(role);
  });

  test('falls back to admin for a scope no role holds', () => {
    expect(minRoleForScope('not-a-scope' as ApiScope)).toBe('admin');
  });
});
