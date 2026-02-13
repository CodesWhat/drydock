import { defineComponent } from 'vue';
import ConfigurationItem from '@/components/ConfigurationItem.vue';
import {
  getAllAuthentications,
  getAuthProviderColor,
  getAuthProviderIcon,
} from '@/services/authentication';

export default defineComponent({
  data() {
    return {
      authentications: [] as any[],
    };
  },
  components: {
    ConfigurationItem,
  },

  async beforeRouteEnter(to, from, next) {
    try {
      const authentications = await getAllAuthentications();
      const authsWithIcons = authentications.map((a) => ({
        ...a,
        icon: getAuthProviderIcon(a.type),
        iconColor: getAuthProviderColor(a.type),
      }));
      next((vm: any) => (vm.authentications = authsWithIcons));
    } catch (e: any) {
      next((vm: any) => {
        vm.$eventBus.emit(
          'notify',
          `Error when trying to load the authentications (${e.message})`,
          'error',
        );
      });
    }
  },
});
