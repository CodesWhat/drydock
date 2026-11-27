import { computed, readonly, ref } from 'vue';

/**
 * What the signed-in user may do, for hiding controls they cannot use. This is
 * UX only: the server enforces the role on every route, so a stale or spoofed
 * value here can show a button that then gets a 403, never grant anything.
 *
 * `/auth/user` supplies the role and scopes. Until it has answered, nothing is
 * known and every control stays visible, which is also what a server from
 * before roles looks like (it sends neither field and everyone was admin).
 */
export type UiRole = 'viewer' | 'operator' | 'admin';

const ROLES: readonly string[] = ['viewer', 'operator', 'admin'];

const role = ref<UiRole | undefined>(undefined);
const scopes = ref<readonly string[] | undefined>(undefined);

export interface CurrentAuthority {
  role?: unknown;
  scopes?: unknown;
}

export function setCurrentAuthority(user: CurrentAuthority | undefined): void {
  role.value =
    typeof user?.role === 'string' && ROLES.includes(user.role) ? (user.role as UiRole) : undefined;
  scopes.value = Array.isArray(user?.scopes)
    ? user.scopes.filter((scope): scope is string => typeof scope === 'string')
    : undefined;
}

/** Can the current user do what `scope` guards? Unknown authority allows. */
export function can(scope: string): boolean {
  if (scopes.value === undefined) {
    return true;
  }
  return scopes.value.includes(scope);
}

export function useCan() {
  return {
    role: readonly(role),
    scopes: readonly(scopes),
    can,
    isAdmin: computed(() => scopes.value === undefined || scopes.value.includes('admin')),
  };
}
