import { defineComponent, inject } from 'vue';
import logo from '@/assets/drydock.png';
import LoginBasic from '@/components/LoginBasic.vue';
import LoginOidc from '@/components/LoginOidc.vue';
import { getOidcRedirection, getStrategies } from '@/services/auth';

export default defineComponent({
  components: {
    LoginBasic,
    LoginOidc,
  },
  setup() {
    const eventBus = inject('eventBus') as any;
    return {
      eventBus,
    };
  },
  data() {
    return {
      logo,
      strategies: [] as any[],
      strategySelected: 0,
      showDialog: true,
      themeMode: (localStorage.themeMode || 'system') as string,
    };
  },

  computed: {
    currentTheme(): string {
      if (this.themeMode === 'system') {
        return globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return this.themeMode;
    },
    isDark(): boolean {
      return this.currentTheme === 'dark';
    },
    themeIcon(): string {
      switch (this.themeMode) {
        case 'light':
          return 'fas fa-sun';
        case 'dark':
          return 'fas fa-moon';
        default:
          return 'fas fa-circle-half-stroke';
      }
    },
    themeIconColor(): string | undefined {
      switch (this.themeMode) {
        case 'light':
          return '#F59E0B';
        case 'dark':
          return '#60A5FA';
        default:
          return undefined;
      }
    },
  },

  methods: {
    /**
     * Is strategy supported for Web UI usage?
     * @param strategy
     * @returns {boolean}
     */
    isSupportedStrategy(strategy: any) {
      switch (strategy.type) {
        case 'basic':
          return true;
        case 'oidc':
          return true;
        default:
          return false;
      }
    },

    cycleTheme() {
      const modes = ['light', 'system', 'dark'];
      const idx = modes.indexOf(this.themeMode);
      this.themeMode = modes[(idx + 1) % modes.length];
      localStorage.themeMode = this.themeMode;
    },

    /**
     * Handle authentication success.
     */
    onAuthenticationSuccess() {
      this.$router.push((this.$route.query.next as string) || '/');
    },
  },

  /**
   * Collect available auth strategies.
   * @param to
   * @param from
   * @param next
   * @returns {Promise<void>}
   */
  async beforeRouteEnter(to, from, next) {
    try {
      const strategies = await getStrategies();

      // If anonymous auth is enabled then no need to login => go home
      if (strategies.some((strategy) => strategy.type === 'anonymous')) {
        next('/');
      }

      // If oidc strategy supporting redirect
      const oidcWithRedirect = strategies.find(
        (strategy) => strategy.type === 'oidc' && strategy.redirect,
      );
      if (oidcWithRedirect) {
        const redirection = await getOidcRedirection(oidcWithRedirect.name);
        globalThis.location.href = redirection.url;
      } else {
        // Filter on supported auth for UI
        next(async (vm: any) => {
          vm.strategies = strategies.filter(vm.isSupportedStrategy);
        });
      }
    } catch (e: any) {
      // Note: In beforeRouteEnter, 'this' is not available, so we'll handle this in the component
      next((vm: any) => {
        if (vm.eventBus) {
          vm.eventBus.emit(
            'notify',
            `Error when trying to get the authentication strategies (${e.message})`,
            'error',
          );
        } else {
          console.error(`Error when trying to get the authentication strategies (${e.message})`);
        }
      });
    }
  },
});
