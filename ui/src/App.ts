import {
  ref,
  computed,
  onMounted,
  onUpdated,
  inject,
  getCurrentInstance,
  watch,
  defineComponent,
} from "vue";
import { useDisplay } from "vuetify";
import NavigationDrawer from "@/components/NavigationDrawer.vue";
import AppBar from "@/components/AppBar.vue";
import SnackBar from "@/components/SnackBar.vue";
import { getServer } from "@/services/server";
import { useRoute } from "vue-router";

function setupAuthStateManagement(user: any, onAuthenticated: (userData: any) => void) {
  return async (newRoute: any) => {
    if (newRoute.name === 'login') {
      user.value = undefined;
    } else if (!user.value) {
      try {
        const response = await fetch("/auth/user", {
          credentials: "include",
        });
        if (response.ok) {
          const currentUser = await response.json();
          if (currentUser && currentUser.username) {
            onAuthenticated(currentUser);
          }
        }
      } catch (e) {
        console.log("Fallback auth check failed:", e);
      }
    }
  };
}

function setupEventBusListeners(
  eventBus: any,
  onAuthenticated: (userData: any) => void,
  notify: (message: string, level?: string) => void,
  notifyClose: () => void
) {
  eventBus.on("authenticated", onAuthenticated);
  eventBus.on("notify", notify);
  eventBus.on("notify:close", notifyClose);
}

async function loadServerConfig(authenticated: any, instance: any) {
  if (
    authenticated.value &&
    instance &&
    !instance.appContext.config.globalProperties.$serverConfig
  ) {
    const server = await getServer();
    instance.appContext.config.globalProperties.$serverConfig =
      server.configuration;
  }
}

export default defineComponent({
  components: {
    NavigationDrawer,
    AppBar,
    SnackBar,
  },
  setup() {
    const route = useRoute();
    const eventBus = inject("eventBus") as any;
    const instance = getCurrentInstance();
    const { smAndDown } = useDisplay();

    const snackbarMessage = ref("");
    const snackbarShow = ref(false);
    const snackbarLevel = ref("info");
    const user = ref(undefined);
    const drawerVisible = ref(false);

    const items = computed(() => {
      return route.fullPath
        .replace("/", "")
        .split("/")
        .map((item) => ({
          text: item ? item : "Home",
          disabled: false,
          href: "",
        }));
    });

    const authenticated = computed(() => {
      return user.value !== undefined;
    });

    const onAuthenticated = (userData: any) => {
      user.value = userData;
    };

    const notify = (message: string, level = "info") => {
      snackbarMessage.value = message;
      snackbarShow.value = true;
      snackbarLevel.value = level;
    };

    const notifyClose = () => {
      snackbarMessage.value = "";
      snackbarShow.value = false;
    };

    onMounted(async () => {
      setupEventBusListeners(eventBus, onAuthenticated, notify, notifyClose);
    });

    watch(route, setupAuthStateManagement(user, onAuthenticated));

    onUpdated(async () => {
      await loadServerConfig(authenticated, instance);
    });

    const toggleDrawer = () => {
      drawerVisible.value = !drawerVisible.value;
    };

    return {
      snackbarMessage,
      snackbarShow,
      snackbarLevel,
      user,
      items,
      authenticated,
      smAndDown,
      drawerVisible,
      toggleDrawer,
    };
  },
});
