import { defineComponent } from 'vue';
import { useDisplay } from 'vuetify';
import IconRenderer from '@/components/IconRenderer.vue';
import { getAuditLog } from '@/services/audit';
import { getAllContainers, getContainerIcon } from '@/services/container';
import { getEffectiveDisplayIcon } from '@/services/image-icon';
import { getAllRegistries, getRegistryIcon } from '@/services/registry';
import { getAllTriggers, getTriggerIcon } from '@/services/trigger';
import { getAllWatchers, getWatcherIcon } from '@/services/watcher';

export default defineComponent({
  components: {
    IconRenderer,
  },

  setup() {
    const { smAndUp, mdAndUp } = useDisplay();
    return { smAndUp, mdAndUp };
  },

  data() {
    return {
      containers: [] as any[],
      watchers: [] as any[],
      containersCount: 0,
      triggersCount: 0,
      watchersCount: 0,
      registriesCount: 0,
      containerIcon: getContainerIcon(),
      registryIcon: getRegistryIcon(),
      triggerIcon: getTriggerIcon(),
      watcherIcon: getWatcherIcon(),
      recentActivity: [] as any[],
      updateTab: 0,
      maintenanceCountdownNow: Date.now(),
      maintenanceCountdownTimer: undefined as number | undefined,
    };
  },

  computed: {
    containersWithUpdates(): any[] {
      return this.containers.filter((c: any) => c.updateAvailable);
    },
    majorUpdates(): any[] {
      return this.containersWithUpdates.filter(
        (c: any) => c.updateKind?.kind === 'tag' && c.updateKind?.semverDiff === 'major',
      );
    },
    minorUpdates(): any[] {
      return this.containersWithUpdates.filter(
        (c: any) => c.updateKind?.kind === 'tag' && c.updateKind?.semverDiff === 'minor',
      );
    },
    patchUpdates(): any[] {
      return this.containersWithUpdates.filter(
        (c: any) => c.updateKind?.kind === 'tag' && c.updateKind?.semverDiff === 'patch',
      );
    },
    digestUpdates(): any[] {
      return this.containersWithUpdates.filter((c: any) => c.updateKind?.kind === 'digest');
    },
    unknownUpdates(): any[] {
      return this.containersWithUpdates.filter(
        (c: any) =>
          !c.updateKind?.kind ||
          c.updateKind?.kind === 'unknown' ||
          (c.updateKind?.kind === 'tag' && c.updateKind?.semverDiff === 'unknown'),
      );
    },
    maintenanceWindowWatchers(): any[] {
      return this.watchers.filter((watcher: any) => watcher.configuration?.maintenancewindow);
    },
    maintenanceWindowOpenCount(): number {
      return this.maintenanceWindowWatchers.filter(
        (watcher: any) => watcher.configuration?.maintenancewindowopen,
      ).length;
    },
    nextMaintenanceWindowAt(): number | undefined {
      const nextWindows = this.maintenanceWindowWatchers
        .map((watcher: any) => watcher.configuration?.maintenancenextwindow)
        .map((value: string | undefined) => {
          if (!value) return undefined;
          const parsedTime = Date.parse(value);
          return Number.isNaN(parsedTime) ? undefined : parsedTime;
        })
        .filter((value: number | undefined) => value !== undefined);
      if (nextWindows.length === 0) {
        return undefined;
      }
      return Math.min(...nextWindows);
    },
    maintenanceCountdownLabel(): string {
      if (this.maintenanceWindowWatchers.length === 0) {
        return '';
      }
      if (this.maintenanceWindowOpenCount > 0) {
        return 'Open now';
      }
      if (!this.nextMaintenanceWindowAt) {
        return 'Scheduled';
      }
      const remainingMs = this.nextMaintenanceWindowAt - this.maintenanceCountdownNow;
      if (remainingMs <= 0) {
        return 'Opening soon';
      }
      return this.formatDuration(remainingMs);
    },
  },

  methods: {
    getEffectiveDisplayIcon,
    formatDuration(durationMs: number): string {
      const totalMinutes = Math.max(1, Math.ceil(durationMs / 60000));
      const days = Math.floor(totalMinutes / (24 * 60));
      const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
      const minutes = totalMinutes % 60;
      if (days > 0) {
        return `${days}d ${hours}h`;
      }
      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes}m`;
    },
    updateKindColor(container: any): string {
      if (container.updateKind?.kind === 'digest') return 'info';
      switch (container.updateKind?.semverDiff) {
        case 'major':
          return 'error';
        case 'minor':
          return 'warning';
        case 'patch':
          return 'success';
        default:
          return 'info';
      }
    },
    updateKindLabel(container: any): string {
      if (container.updateKind?.kind === 'digest') return 'digest';
      return container.updateKind?.semverDiff || 'unknown';
    },
    actionIcon(action: string): string {
      const map: Record<string, string> = {
        'update-available': 'fas fa-circle-info',
        'update-applied': 'fas fa-circle-check',
        'update-failed': 'fas fa-circle-xmark',
        'container-added': 'fas fa-circle-plus',
        'container-removed': 'fas fa-circle-minus',
        rollback: 'fas fa-rotate-left',
        preview: 'fas fa-eye',
      };
      return map[action] || 'fas fa-circle-question';
    },
    actionColor(action: string): string {
      const map: Record<string, string> = {
        'update-available': 'info',
        'update-applied': 'success',
        'update-failed': 'error',
        'container-added': 'primary',
        'container-removed': 'warning',
        rollback: 'warning',
        preview: 'secondary',
      };
      return map[action] || 'default';
    },
    formatTime(ts: string): string {
      if (!ts) return '';
      return new Date(ts).toLocaleString();
    },
  },

  async beforeRouteEnter(to, from, next) {
    try {
      const containers = await getAllContainers();
      const watchers = await getAllWatchers();
      const registries = await getAllRegistries();
      const triggers = await getAllTriggers();

      let recentActivity: any[] = [];
      try {
        const auditResult = await getAuditLog({ limit: 5 });
        recentActivity = auditResult.entries || [];
      } catch {
        // Audit log may not be available yet
      }

      next((vm: any) => {
        vm.containers = containers;
        vm.watchers = watchers;
        vm.containersCount = containers.length;
        vm.triggersCount = triggers.length;
        vm.watchersCount = watchers.length;
        vm.registriesCount = registries.length;
        vm.recentActivity = recentActivity;
      });
    } catch (e) {
      next(() => {
        console.log(e);
      });
    }
  },

  mounted() {
    this.maintenanceCountdownTimer = window.setInterval(() => {
      this.maintenanceCountdownNow = Date.now();
    }, 30 * 1000);
  },

  beforeUnmount() {
    if (this.maintenanceCountdownTimer !== undefined) {
      clearInterval(this.maintenanceCountdownTimer);
      this.maintenanceCountdownTimer = undefined;
    }
  },
});
