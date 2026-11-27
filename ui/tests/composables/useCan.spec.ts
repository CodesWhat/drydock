import { can, setCurrentAuthority, useCan } from '@/composables/useCan';

describe('useCan', () => {
  afterEach(() => setCurrentAuthority(undefined));

  it('allows everything until the server has said what the user holds', () => {
    expect(can('admin')).toBe(true);
    expect(useCan().isAdmin.value).toBe(true);
    expect(useCan().role.value).toBeUndefined();
  });

  it('allows only the scopes the user holds', () => {
    setCurrentAuthority({ role: 'viewer', scopes: ['read'] });
    expect(can('read')).toBe(true);
    expect(can('containers:update')).toBe(false);
    expect(useCan().isAdmin.value).toBe(false);
    expect(useCan().role.value).toBe('viewer');
  });

  it('gives an operator update and control but not admin', () => {
    setCurrentAuthority({
      role: 'operator',
      scopes: ['read', 'containers:watch', 'containers:update', 'containers:control'],
    });
    expect(can('containers:update')).toBe(true);
    expect(can('containers:control')).toBe(true);
    expect(can('admin')).toBe(false);
  });

  it('ignores an unknown role and non-string scopes', () => {
    setCurrentAuthority({ role: 'root', scopes: ['read', 5] });
    expect(useCan().role.value).toBeUndefined();
    expect(can('read')).toBe(true);
    expect(can('admin')).toBe(false);
  });

  it('treats a non-array scopes value as unknown', () => {
    setCurrentAuthority({ role: 'admin', scopes: 'admin' });
    expect(can('admin')).toBe(true);
    expect(useCan().role.value).toBe('admin');
  });
});
