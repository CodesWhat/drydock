import { defineComponent } from 'vue';
import ConfigurationItem from '@/components/ConfigurationItem.vue';
import WebhookInfo from '@/components/WebhookInfo.vue';
import { getLog } from '@/services/log';
import { getServer } from '@/services/server';
import { getStore } from '@/services/store';

export default defineComponent({
  components: {
    ConfigurationItem,
    WebhookInfo,
  },
  data() {
    return {
      server: {} as any,
      store: {} as any,
      log: {} as any,
    };
  },
  computed: {
    serverConfiguration() {
      return {
        type: 'server',
        name: 'configuration',
        icon: 'fas fa-gear',
        iconColor: '#6B7280',
        configuration: this.server.configuration,
      };
    },
    logConfiguration() {
      return {
        type: 'logs',
        name: 'configuration',
        icon: 'fas fa-file-lines',
        iconColor: '#8B5CF6',
        configuration: this.log,
      };
    },
    storeConfiguration() {
      return {
        type: 'store',
        name: 'configuration',
        icon: 'fas fa-copy',
        iconColor: '#0096C7',
        configuration: this.store.configuration,
      };
    },
    webhookEnabled() {
      return this.server?.configuration?.webhook?.enabled === true;
    },
    webhookBaseUrl() {
      return globalThis.location.origin;
    },
  },

  async beforeRouteEnter(to, from, next) {
    try {
      const server = await getServer();
      const store = await getStore();
      const log = await getLog();

      next((vm: any) => {
        vm.server = server;
        vm.store = store;
        vm.log = log;
      });
    } catch (e: any) {
      next((vm: any) => {
        vm.$eventBus.emit(
          'notify',
          `Error when trying to load the state configuration (${e.message})`,
          'error',
        );
      });
    }
  },
});
