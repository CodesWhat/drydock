import { i18n } from '../boot/i18n';
import { useToast } from '../composables/useToast';

/** The error text the server sends when a role is below a route's floor. */
const ROLE_DENIAL_MESSAGE = 'Role does not permit this action';

let installed = false;

async function isRoleDenial(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return false;
  }
  try {
    const body: unknown = await response.clone().json();
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as { error?: unknown }).error === ROLE_DENIAL_MESSAGE
    );
  } catch {
    return false;
  }
}

/**
 * Toast when the server says the caller's role does not permit a request.
 * Wraps `fetch` so every service gets it without each one learning about
 * roles. The response is returned untouched.
 */
export function installPermissionDeniedToast(): void {
  if (installed) {
    return;
  }
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    if (await isRoleDenial(response)) {
      useToast().warning(
        i18n.global.t('appShell.layout.permissionDenied.title'),
        i18n.global.t('appShell.layout.permissionDenied.body'),
      );
    }
    return response;
  };
}
