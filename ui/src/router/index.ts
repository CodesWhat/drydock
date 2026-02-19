import { nextTick } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { getUser } from '@/services/auth';

export const viewLoaders = {
  dashboard: () => import('../views/DashboardView.vue'),
  login: () => import('../views/LoginView.vue'),
  containers: () => import('../views/ContainersView.vue'),
  security: () => import('../views/SecurityView.vue'),
  servers: () => import('../views/ServersView.vue'),
  config: () => import('../views/ConfigView.vue'),
  registries: () => import('../views/RegistriesView.vue'),
  agents: () => import('../views/AgentsView.vue'),
  triggers: () => import('../views/TriggersView.vue'),
  watchers: () => import('../views/WatchersView.vue'),
  auth: () => import('../views/AuthView.vue'),
  notifications: () => import('../views/NotificationsView.vue'),
  profile: () => import('../views/ProfileView.vue'),
};

export function createLazyRoute(path: string, name: keyof typeof viewLoaders) {
  return { path, name, component: viewLoaders[name] };
}

const routes = [
  createLazyRoute('/', 'dashboard'),
  createLazyRoute('/login', 'login'),
  createLazyRoute('/containers', 'containers'),
  createLazyRoute('/security', 'security'),
  createLazyRoute('/servers', 'servers'),
  createLazyRoute('/config', 'config'),
  createLazyRoute('/registries', 'registries'),
  createLazyRoute('/agents', 'agents'),
  createLazyRoute('/triggers', 'triggers'),
  createLazyRoute('/watchers', 'watchers'),
  createLazyRoute('/auth', 'auth'),
  createLazyRoute('/notifications', 'notifications'),
  createLazyRoute('/profile', 'profile'),
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

/**
 * Validate and return the `next` query parameter as a safe redirect path.
 * Returns the path string if valid, or `true` to proceed to the current route.
 */
export function validateAndGetNextRoute(to: any): string | boolean {
  if (to.query.next) {
    const next = String(to.query.next);
    if (next.startsWith('/') && !next.startsWith('//')) {
      return next;
    }
  }
  return true;
}

/**
 * Create a redirect object that sends the user to the login page,
 * preserving the original destination as the `next` query parameter.
 */
export function createLoginRedirect(to: any) {
  return {
    name: 'login',
    query: {
      next: to.path,
    },
  };
}

/**
 * Apply authentication navigation guard.
 */
export async function applyAuthNavigationGuard(to: any) {
  if (to.name === 'login') {
    return true;
  }

  const user = await getUser();

  if (user !== undefined) {
    return validateAndGetNextRoute(to);
  }

  return createLoginRedirect(to);
}

/**
 * Apply navigation guards.
 */
router.beforeEach(async (to) => {
  return await applyAuthNavigationGuard(to);
});

export default router;
