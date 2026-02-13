import {
  computed,
  defineComponent,
  getCurrentInstance,
  inject,
  onMounted,
  onUnmounted,
  onUpdated,
  ref,
  watch,
} from 'vue';
import { useRoute } from 'vue-router';
import { useDisplay } from 'vuetify';
import AppBar from '@/components/AppBar.vue';
import NavigationDrawer from '@/components/NavigationDrawer.vue';
import SelfUpdateOverlay from '@/components/SelfUpdateOverlay.vue';
import SnackBar from '@/components/SnackBar.vue';
import { getServer } from '@/services/server';
import sseService from '@/services/sse';

export function setupAuthStateManagement(user: any, onAuthenticated: (userData: any) => void) {
  return async (newRoute: any) => {
    if (newRoute.name === 'login') {
      user.value = undefined;
    } else if (!user.value) {
      try {
        const response = await fetch('/auth/user', {
          credentials: 'include',
        });
        if (response.ok) {
          const currentUser = await response.json();
          if (currentUser?.username) {
            onAuthenticated(currentUser);
          }
        }
      } catch (e) {
        console.log('Fallback auth check failed:', e);
      }
    }
  };
}

export function setupEventBusListeners(
  eventBus: any,
  onAuthenticated: (userData: any) => void,
  notify: (message: string, level?: string) => void,
  notifyClose: () => void,
) {
  eventBus.on('authenticated', onAuthenticated);
  eventBus.on('notify', notify);
  eventBus.on('notify:close', notifyClose);
}

export async function loadServerConfig(authenticated: any, instance: any) {
  if (
    authenticated.value &&
    instance &&
    !instance.appContext.config.globalProperties.$serverConfig
  ) {
    const server = await getServer();
    instance.appContext.config.globalProperties.$serverConfig = server.configuration;
  }
}

export default defineComponent({
  components: {
    NavigationDrawer,
    AppBar,
    SelfUpdateOverlay,
    SnackBar,
  },
  setup() {
    const route = useRoute();
    const eventBus = inject('eventBus') as any;
    const instance = getCurrentInstance();
    const { smAndDown } = useDisplay();

    const snackbarMessage = ref('');
    const snackbarShow = ref(false);
    const snackbarLevel = ref('info');
    const user = ref(undefined);
    const drawerVisible = ref(false);

    const items = computed(() => {
      return route.fullPath
        .replace('/', '')
        .split('/')
        .map((item) => ({
          text: item || 'Home',
          disabled: false,
          href: '',
        }));
    });

    const authenticated = computed(() => {
      return user.value !== undefined;
    });

    const onAuthenticated = (userData: any) => {
      user.value = userData;
    };

    const notify = (message: string, level = 'info') => {
      snackbarMessage.value = message;
      snackbarShow.value = true;
      snackbarLevel.value = level;
    };

    const notifyClose = () => {
      snackbarMessage.value = '';
      snackbarShow.value = false;
    };

    onMounted(async () => {
      setupEventBusListeners(eventBus, onAuthenticated, notify, notifyClose);
      sseService.connect(eventBus);
    });

    onUnmounted(() => {
      sseService.disconnect();
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
