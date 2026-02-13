import { defineComponent } from 'vue';
import ConfigurationItem from '@/components/ConfigurationItem.vue';
import {
  getAllWatchers,
  getWatcherProviderColor,
  getWatcherProviderIcon,
} from '@/services/watcher';

export default defineComponent({
  data() {
    return {
      watchers: [] as any[],
    };
  },
  components: {
    ConfigurationItem,
  },
  async beforeRouteEnter(to, from, next) {
    try {
      const watchers = await getAllWatchers();
      const watchersWithIcons = watchers.map((w) => ({
        ...w,
        icon: getWatcherProviderIcon(w.type),
        iconColor: getWatcherProviderColor(w.type),
      }));
      next((vm: any) => {
        vm.watchers = watchersWithIcons;
      });
    } catch (e: any) {
      next((vm: any) => {
        vm.$eventBus.emit(
          'notify',
          `Error when trying to load the watchers (${e.message})`,
          'error',
        );
      });
    }
  },
});
