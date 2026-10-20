import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from 'vue-router';
import {
  clearStaleChunkReloadGuard,
  requestStaleChunkReload,
} from '@/bootstrap/stale-chunk-recovery';
import { useApiKeyReview } from '@/composables/useApiKeyReview';
import AppLayout from '@/layouts/AppLayout.vue';
import { hydrateFromServer } from '@/preferences/sync';
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
  images: () => import('../views/ImagesView.vue'),
  auth: () => import('../views/AuthView.vue'),
  notifications: () => import('../views/NotificationsView.vue'),
  notificationOutbox: () => import('../views/NotificationOutboxView.vue'),
  audit: () => import('../views/AuditView.vue'),
  logs: () => import('../views/LogsView.vue'),
  containerLogs: () => import('../views/ContainerLogsView.vue'),
  approvals: () => import('../views/ApprovalsView.vue'),
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
      createLazyRoute(ROUTES.IMAGES, 'images'),
      createLazyRoute(ROUTES.AUTH, 'auth'),
      createLazyRoute(ROUTES.NOTIFICATIONS, 'notifications'),
      createLazyRoute(ROUTES.NOTIFICATION_OUTBOX, 'notificationOutbox', 'notification-outbox'),
      createLazyRoute(ROUTES.AUDIT, 'audit'),
      createLazyRoute(ROUTES.LOGS, 'logs'),
      createLazyRoute(ROUTES.APPROVALS, 'approvals'),
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

interface AuthenticatedUser {
  username?: string;
  apiKeyReviewPending?: boolean;
}

const API_KEY_REVIEW_LOCATION = { path: ROUTES.CONFIG, query: { tab: 'apiKeys' } };

function isApiKeyReviewRoute(to: RouteLocationNormalized): boolean {
  return to.path === ROUTES.CONFIG && to.query.tab === 'apiKeys';
}

/**
 * Apply authentication navigation guard.
 */
async function applyAuthNavigationGuard(to: RouteLocationNormalized) {
  if (to.name === 'login') {
    return true;
  }

  const user = (await getUser()) as AuthenticatedUser | undefined;

  if (user !== undefined) {
    const reviewPending = user.apiKeyReviewPending === true;
    useApiKeyReview().setApiKeyReviewPending(reviewPending);
    // A recovery-code sign-in owes a look at the API keys before anything else.
    // Logout is a request, not a route, so it stays reachable from here.
    if (reviewPending && !isApiKeyReviewRoute(to)) {
      return API_KEY_REVIEW_LOCATION;
    }
    if (user.username && user.username !== 'anonymous') {
      // Fire-and-forget — the preference fetch has no timeout, and navigation
      // must never block on it; hydrateFromServer swallows its own errors.
      void hydrateFromServer(user.username);
    }
    // A `next` target would only bounce straight back to the review.
    return reviewPending ? true : validateAndGetNextRoute(to);
  }

  return createLoginRedirect(to);
}

/**
 * Apply navigation guards.
 */
router.beforeEach(async (to) => {
  return await applyAuthNavigationGuard(to);
});

router.onError((error) => {
  requestStaleChunkReload(error);
});

router.afterEach((_to, _from, failure) => {
  if (!failure) {
    clearStaleChunkReloadGuard();
  }
});

export default router;
