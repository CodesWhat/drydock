import { defineComponent } from 'vue';
import TriggerDetail from '@/components/TriggerDetail.vue';
import {
  getAllTriggers,
  getTriggerProviderColor,
  getTriggerProviderIcon,
} from '@/services/trigger';

export default defineComponent({
  data() {
    return {
      triggers: [] as any[],
    };
  },
  components: {
    TriggerDetail,
  },

  async beforeRouteEnter(to, from, next) {
    try {
      const triggers = await getAllTriggers();
      const triggersWithIcons = triggers.map((t) => ({
        ...t,
        icon: getTriggerProviderIcon(t.type),
        iconColor: getTriggerProviderColor(t.type),
      }));
      next((vm: any) => (vm.triggers = triggersWithIcons));
    } catch (e: any) {
      next((vm: any) => {
        vm.$eventBus.emit(
          'notify',
          `Error when trying to load the triggers (${e.message})`,
          'error',
        );
      });
    }
  },
});
