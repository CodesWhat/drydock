import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from 'vue-router';
import AppLayout from '@/layouts/AppLayout.vue';
import { getUser } from '@/services/auth';
import { ROUTES } from './routes';

const viewLoaders = {
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
  audit: () => import('../views/AuditView.vue'),
  logs: () => import('../views/LogsView.vue'),
  containerLogs: () => import('../views/ContainerLogsView.vue'),
};

function createLazyRoute(
  path: string,
  viewName: keyof typeof viewLoaders,
  routeName: string = viewName,
): RouteRecordRaw {
  return { path, name: routeName, component: viewLoaders[viewName] };
}

const routes: RouteRecordRaw[] = [
  createLazyRoute(ROUTES.LOGIN, 'login'),
  {
    path: ROUTES.DASHBOARD,
    component: AppLayout,
    children: [
      createLazyRoute('', 'dashboard'),
      createLazyRoute(ROUTES.CONTAINERS, 'containers'),
      createLazyRoute(ROUTES.CONTAINER_LOGS, 'containerLogs', 'container-logs'),
      createLazyRoute(ROUTES.SECURITY, 'security'),
      createLazyRoute(ROUTES.SERVERS, 'servers'),
      createLazyRoute(ROUTES.CONFIG, 'config'),
      createLazyRoute(ROUTES.REGISTRIES, 'registries'),
      createLazyRoute(ROUTES.AGENTS, 'agents'),
      createLazyRoute(ROUTES.TRIGGERS, 'triggers'),
      createLazyRoute(ROUTES.WATCHERS, 'watchers'),
      createLazyRoute(ROUTES.AUTH, 'auth'),
      createLazyRoute(ROUTES.NOTIFICATIONS, 'notifications'),
      createLazyRoute(ROUTES.AUDIT, 'audit'),
      createLazyRoute(ROUTES.LOGS, 'logs'),
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: ROUTES.DASHBOARD },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

/**
 * Validate and return the `next` query parameter as a safe redirect path.
 * Returns the path string if valid, or `true` to proceed to the current route.
 */
function validateAndGetNextRoute(to: RouteLocationNormalized): string | boolean {
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
function createLoginRedirect(to: RouteLocationNormalized) {
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
async function applyAuthNavigationGuard(to: RouteLocationNormalized) {
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
