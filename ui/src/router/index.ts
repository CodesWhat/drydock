import { nextTick } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { getUser } from '@/services/auth';

export const viewLoaders = {
  home: () => import('../views/HomeView.vue'),
  login: () => import('../views/LoginView.vue'),
  containers: () => import('../views/ContainersView.vue'),
  authentications: () => import('../views/ConfigurationAuthenticationsView.vue'),
  registries: () => import('../views/ConfigurationRegistriesView.vue'),
  server: () => import('../views/ConfigurationServerView.vue'),
  triggers: () => import('../views/ConfigurationTriggersView.vue'),
  watchers: () => import('../views/ConfigurationWatchersView.vue'),
  agents: () => import('../views/ConfigurationAgentsView.vue'),
  logs: () => import('../views/ConfigurationLogsView.vue'),
  history: () => import('../views/MonitoringHistoryView.vue'),
};

export function createLazyRoute(path, name: keyof typeof viewLoaders) {
  return { path, name, component: viewLoaders[name] };
}

const routes = [
  createLazyRoute('/', 'home'),
  createLazyRoute('/login', 'login'),
  createLazyRoute('/containers', 'containers'),
  createLazyRoute('/configuration/authentications', 'authentications'),
  createLazyRoute('/configuration/registries', 'registries'),
  createLazyRoute('/configuration/server', 'server'),
  createLazyRoute('/configuration/triggers', 'triggers'),
  createLazyRoute('/configuration/watchers', 'watchers'),
  createLazyRoute('/configuration/agents', 'agents'),
  createLazyRoute('/configuration/logs', 'logs'),
  createLazyRoute('/monitoring/history', 'history'),
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes,
});

/**
 * Validate and return the `next` query parameter as a safe redirect path.
 * Returns the path string if valid, or `true` to proceed to the current route.
 */
export function validateAndGetNextRoute(to): string | boolean {
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
export function createLoginRedirect(to) {
  return {
    name: 'login',
    query: {
      next: to.path,
    },
  };
}

/**
 * Apply authentication navigation guard.
 * @param to
 * @param from
 * @returns {Promise<void>}
 */
export async function applyAuthNavigationGuard(to) {
  if (to.name === 'login') {
    return true;
  }

  // Get current user
  const user = await getUser();

  // User is authenticated => go to route
  if (user !== undefined) {
    // Emit authenticated event after navigation
    nextTick(() => {
      if ((router as any).app?.config?.globalProperties?.$eventBus) {
        (router as any).app.config.globalProperties.$eventBus.emit('authenticated', user);
      }
    });

    return validateAndGetNextRoute(to);
  }

  // User is not authenticated => save destination as next & go to login
  return createLoginRedirect(to);
}

/**
 * Apply navigation guards.
 */
router.beforeEach(async (to) => {
  return await applyAuthNavigationGuard(to);
});

export default router;
