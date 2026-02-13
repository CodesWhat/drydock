import { computed, defineComponent, inject, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTheme } from 'vuetify';
import logo from '@/assets/whale-logo.png';
import { logout } from '@/services/auth';

export default defineComponent({
  props: {
    user: {
      type: Object,
      required: true,
    },
    showMenuToggle: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['toggle-drawer'],
  setup() {
    const route = useRoute();
    const router = useRouter();
    const eventBus = inject('eventBus') as any;
    const theme = useTheme();

    const viewName = computed(() => {
      return route.name;
    });

    // Theme management (moved from NavigationDrawer)
    if (localStorage.darkMode !== undefined && localStorage.themeMode === undefined) {
      localStorage.themeMode = localStorage.darkMode === 'true' ? 'dark' : 'light';
      localStorage.removeItem('darkMode');
    }

    const themeMode = ref<string>(localStorage.themeMode || 'system');

    const applyTheme = () => {
      let isDark: boolean;
      if (themeMode.value === 'system') {
        isDark = globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
      } else {
        isDark = themeMode.value === 'dark';
      }
      theme.global.name.value = isDark ? 'dark' : 'light';
    };

    const onThemeModeChange = (value: string) => {
      themeMode.value = value;
      localStorage.themeMode = value;
      applyTheme();
    };

    const themeIcon = computed(() => {
      switch (themeMode.value) {
        case 'light':
          return 'fas fa-sun';
        case 'dark':
          return 'fas fa-moon';
        default:
          return 'fas fa-circle-half-stroke';
      }
    });

    const cycleTheme = () => {
      const modes = ['light', 'system', 'dark'];
      const idx = modes.indexOf(themeMode.value);
      onThemeModeChange(modes[(idx + 1) % modes.length]);
    };

    const themeLabel = computed(() => {
      switch (themeMode.value) {
        case 'light':
          return 'Light';
        case 'dark':
          return 'Dark';
        default:
          return 'System';
      }
    });

    const isDark = computed(() => theme.global.name.value === 'dark');

    const themeIconColor = computed(() => {
      switch (themeMode.value) {
        case 'light':
          return '#F59E0B';
        case 'dark':
          return '#60A5FA';
        default:
          return undefined;
      }
    });

    onMounted(() => {
      applyTheme();
      globalThis.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (themeMode.value === 'system') {
          applyTheme();
        }
      });
    });

    const performLogout = async () => {
      try {
        const logoutResult = await logout();
        if (logoutResult.logoutUrl) {
          globalThis.location = logoutResult.logoutUrl;
        } else {
          await router.push({
            name: 'login',
          });
        }
      } catch (e: any) {
        eventBus.emit('notify', `Error when trying to logout (${e.message})`, 'error');
      }
    };

    return {
      logo,
      isDark,
      viewName,
      logout: performLogout,
      themeMode,
      themeIcon,
      themeLabel,
      themeIconColor,
      cycleTheme,
      onThemeModeChange,
    };
  },
});
