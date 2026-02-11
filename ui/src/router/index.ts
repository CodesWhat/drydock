import { createRouter, createWebHistory } from "vue-router";
import { getUser } from "@/services/auth";
import { nextTick } from "vue";

const routes = [
  {
    path: "/",
    name: "home",
    component: () => import("../views/HomeView.vue"),
  },
  {
    path: "/login",
    name: "login",
    component: () => import("../views/LoginView.vue"),
  },
  {
    path: "/containers",
    name: "containers",
    component: () => import("../views/ContainersView.vue"),
  },
  {
    path: "/configuration/authentications",
    name: "authentications",
    component: () => import("../views/ConfigurationAuthenticationsView.vue"),
  },
  {
    path: "/configuration/registries",
    name: "registries",
    component: () => import("../views/ConfigurationRegistriesView.vue"),
  },
  {
    path: "/configuration/server",
    name: "server",
    component: () => import("../views/ConfigurationServerView.vue"),
  },
  {
    path: "/configuration/triggers",
    name: "triggers",
    component: () => import("../views/ConfigurationTriggersView.vue"),
  },
  {
    path: "/configuration/watchers",
    name: "watchers",
    component: () => import("../views/ConfigurationWatchersView.vue"),
  },
  {
    path: "/configuration/agents",
    name: "agents",
    component: () => import("../views/ConfigurationAgentsView.vue"),
  },
  {
    path: "/configuration/logs",
    name: "logs",
    component: () => import("../views/ConfigurationLogsView.vue"),
  },
  {
    path: "/monitoring/history",
    name: "history",
    component: () => import("../views/MonitoringHistoryView.vue"),
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/",
  },
];

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes,
});

/**
 * Validate and return the `next` query parameter as a safe redirect path.
 * Returns the path string if valid, or `true` to proceed to the current route.
 */
function validateAndGetNextRoute(to): string | boolean {
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
function createLoginRedirect(to) {
  return {
    name: "login",
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
async function applyAuthNavigationGuard(to) {
  if (to.name === "login") {
    return true;
  } else {
    // Get current user
    const user = await getUser();

    // User is authenticated => go to route
    if (user !== undefined) {
      // Emit authenticated event after navigation
      nextTick(() => {
        if ((router as any).app?.config?.globalProperties?.$eventBus) {
          (router as any).app.config.globalProperties.$eventBus.emit("authenticated", user);
        }
      });

      return validateAndGetNextRoute(to);
    } else {
      // User is not authenticated => save destination as next & go to login
      return createLoginRedirect(to);
    }
  }
}

/**
 * Apply navigation guards.
 */
router.beforeEach(async (to) => {
  return await applyAuthNavigationGuard(to);
});



export default router;
