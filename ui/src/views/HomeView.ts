import { getContainerIcon, getAllContainers } from "@/services/container";
import { getRegistryIcon, getAllRegistries } from "@/services/registry";
import { getTriggerIcon, getAllTriggers } from "@/services/trigger";
import { getWatcherIcon, getAllWatchers } from "@/services/watcher";
import { getAuditLog } from "@/services/audit";
import { getEffectiveDisplayIcon } from "@/services/image-icon";
import IconRenderer from "@/components/IconRenderer.vue";
import { useDisplay } from "vuetify";
import { defineComponent } from "vue";

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
    };
  },

  computed: {
    containersWithUpdates(): any[] {
      return this.containers.filter((c: any) => c.updateAvailable);
    },
    majorUpdates(): any[] {
      return this.containersWithUpdates.filter(
        (c: any) => c.updateKind?.kind === "tag" && c.updateKind?.semverDiff === "major",
      );
    },
    minorUpdates(): any[] {
      return this.containersWithUpdates.filter(
        (c: any) => c.updateKind?.kind === "tag" && c.updateKind?.semverDiff === "minor",
      );
    },
    patchUpdates(): any[] {
      return this.containersWithUpdates.filter(
        (c: any) => c.updateKind?.kind === "tag" && c.updateKind?.semverDiff === "patch",
      );
    },
    digestUpdates(): any[] {
      return this.containersWithUpdates.filter(
        (c: any) => c.updateKind?.kind === "digest",
      );
    },
    unknownUpdates(): any[] {
      return this.containersWithUpdates.filter(
        (c: any) =>
          !c.updateKind?.kind ||
          c.updateKind?.kind === "unknown" ||
          (c.updateKind?.kind === "tag" && c.updateKind?.semverDiff === "unknown"),
      );
    },
    filteredUpdates(): any[] {
      const tabs = [
        this.containersWithUpdates,
        this.majorUpdates,
        this.minorUpdates,
        this.patchUpdates,
        this.digestUpdates,
        this.unknownUpdates,
      ];
      return tabs[this.updateTab] || this.containersWithUpdates;
    },
    upToDateCount(): number {
      return this.containersCount - this.containersWithUpdates.length;
    },
  },

  methods: {
    getEffectiveDisplayIcon,
    updateKindColor(container: any): string {
      if (container.updateKind?.kind === "digest") return "info";
      switch (container.updateKind?.semverDiff) {
        case "major": return "error";
        case "minor": return "warning";
        case "patch": return "success";
        default: return "info";
      }
    },
    updateKindLabel(container: any): string {
      if (container.updateKind?.kind === "digest") return "digest";
      return container.updateKind?.semverDiff || "unknown";
    },
    actionIcon(action: string): string {
      const map: Record<string, string> = {
        "update-available": "fas fa-circle-info",
        "update-applied": "fas fa-circle-check",
        "update-failed": "fas fa-circle-xmark",
        "container-added": "fas fa-circle-plus",
        "container-removed": "fas fa-circle-minus",
        rollback: "fas fa-rotate-left",
        preview: "fas fa-eye",
      };
      return map[action] || "fas fa-circle-question";
    },
    actionColor(action: string): string {
      const map: Record<string, string> = {
        "update-available": "info",
        "update-applied": "success",
        "update-failed": "error",
        "container-added": "primary",
        "container-removed": "warning",
        rollback: "warning",
        preview: "secondary",
      };
      return map[action] || "default";
    },
    formatTime(ts: string): string {
      if (!ts) return "";
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
});
