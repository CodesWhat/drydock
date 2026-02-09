import ConfigurationItem from "@/components/ConfigurationItem.vue";
import { getAllWatchers } from "@/services/watcher";
import { defineComponent } from "vue";

type SchedulerMode =
  | "hourly"
  | "every-n-hours"
  | "daily"
  | "weekly"
  | "custom";

type SchedulerModel = {
  mode: SchedulerMode;
  minute: number;
  hour: number;
  intervalHours: number;
  weekday: number;
  cron: string;
};

export default defineComponent({
  data() {
    return {
      watchers: [] as any[],
      schedulerByWatcher: {} as Record<string, SchedulerModel>,
      scheduleModes: [
        { label: "Every hour", value: "hourly" },
        { label: "Every N hours", value: "every-n-hours" },
        { label: "Daily", value: "daily" },
        { label: "Weekly", value: "weekly" },
        { label: "Custom CRON", value: "custom" },
      ],
      weekDays: [
        { label: "Sunday", value: 0 },
        { label: "Monday", value: 1 },
        { label: "Tuesday", value: 2 },
        { label: "Wednesday", value: 3 },
        { label: "Thursday", value: 4 },
        { label: "Friday", value: 5 },
        { label: "Saturday", value: 6 },
      ],
    };
  },
  components: {
    ConfigurationItem,
  },
  methods: {
    clampInt(value: unknown, min: number, max: number, fallback: number) {
      const parsed = Number.parseInt(String(value), 10);
      if (Number.isNaN(parsed)) {
        return fallback;
      }
      return Math.min(Math.max(parsed, min), max);
    },

    parseCron(cronValue: string): SchedulerModel {
      const cron = String(cronValue || "0 * * * *").trim();

      const hourlyMatch = /^(\d{1,2}) \* \* \* \*$/.exec(cron);
      if (hourlyMatch) {
        return {
          mode: "hourly",
          minute: this.clampInt(hourlyMatch[1], 0, 59, 0),
          hour: 0,
          intervalHours: 1,
          weekday: 1,
          cron,
        };
      }

      const everyNHoursMatch = /^(\d{1,2}) \*\/(\d{1,2}) \* \* \*$/.exec(cron);
      if (everyNHoursMatch) {
        return {
          mode: "every-n-hours",
          minute: this.clampInt(everyNHoursMatch[1], 0, 59, 0),
          hour: 0,
          intervalHours: this.clampInt(everyNHoursMatch[2], 1, 23, 2),
          weekday: 1,
          cron,
        };
      }

      const weeklyMatch = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/.exec(cron);
      if (weeklyMatch) {
        return {
          mode: "weekly",
          minute: this.clampInt(weeklyMatch[1], 0, 59, 0),
          hour: this.clampInt(weeklyMatch[2], 0, 23, 0),
          intervalHours: 1,
          weekday: this.clampInt(weeklyMatch[3], 0, 6, 1),
          cron,
        };
      }

      const dailyMatch = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron);
      if (dailyMatch) {
        return {
          mode: "daily",
          minute: this.clampInt(dailyMatch[1], 0, 59, 0),
          hour: this.clampInt(dailyMatch[2], 0, 23, 0),
          intervalHours: 1,
          weekday: 1,
          cron,
        };
      }

      return {
        mode: "custom",
        minute: 0,
        hour: 0,
        intervalHours: 1,
        weekday: 1,
        cron,
      };
    },

    buildCron(model: SchedulerModel) {
      const minute = this.clampInt(model.minute, 0, 59, 0);
      const hour = this.clampInt(model.hour, 0, 23, 0);
      const intervalHours = this.clampInt(model.intervalHours, 1, 23, 2);
      const weekday = this.clampInt(model.weekday, 0, 6, 1);

      if (model.mode === "hourly") {
        return `${minute} * * * *`;
      }
      if (model.mode === "every-n-hours") {
        return `${minute} */${intervalHours} * * *`;
      }
      if (model.mode === "daily") {
        return `${minute} ${hour} * * *`;
      }
      if (model.mode === "weekly") {
        return `${minute} ${hour} * * ${weekday}`;
      }
      return String(model.cron || "").trim();
    },

    initializeSchedulers(watchers: any[]) {
      const schedulerByWatcher: Record<string, SchedulerModel> = {};
      (watchers || []).forEach((watcher: any) => {
        if (!watcher || !watcher.id || !watcher.configuration?.cron) {
          return;
        }
        schedulerByWatcher[watcher.id] = this.parseCron(
          watcher.configuration.cron,
        );
      });
      this.schedulerByWatcher = schedulerByWatcher;
    },

    onSchedulerFieldChange(watcher: any) {
      const watcherId = watcher?.id;
      const model = this.schedulerByWatcher[watcherId];
      if (!model) {
        return;
      }

      model.minute = this.clampInt(model.minute, 0, 59, 0);
      model.hour = this.clampInt(model.hour, 0, 23, 0);
      model.intervalHours = this.clampInt(model.intervalHours, 1, 23, 2);
      model.weekday = this.clampInt(model.weekday, 0, 6, 1);

      if (model.mode !== "custom") {
        model.cron = this.buildCron(model);
      } else {
        model.cron = String(model.cron || "").trim();
      }

      if (!watcher.configuration) {
        watcher.configuration = {};
      }
      watcher.configuration.cron = model.cron;
    },

    humanizeCron(cronValue: string) {
      const cron = String(cronValue || "").trim();
      if (!cron) {
        return "No schedule configured";
      }

      const weekDayLabels = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];

      const hourlyMatch = /^(\d{1,2}) \* \* \* \*$/.exec(cron);
      if (hourlyMatch) {
        return `Every hour at minute ${this.clampInt(hourlyMatch[1], 0, 59, 0)}`;
      }

      const everyNHoursMatch = /^(\d{1,2}) \*\/(\d{1,2}) \* \* \*$/.exec(cron);
      if (everyNHoursMatch) {
        const minute = this.clampInt(everyNHoursMatch[1], 0, 59, 0);
        const interval = this.clampInt(everyNHoursMatch[2], 1, 23, 2);
        return `Every ${interval} hours at minute ${minute}`;
      }

      const dailyMatch = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron);
      if (dailyMatch) {
        const minute = this.clampInt(dailyMatch[1], 0, 59, 0)
          .toString()
          .padStart(2, "0");
        const hour = this.clampInt(dailyMatch[2], 0, 23, 0)
          .toString()
          .padStart(2, "0");
        return `Daily at ${hour}:${minute}`;
      }

      const weeklyMatch = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/.exec(cron);
      if (weeklyMatch) {
        const minute = this.clampInt(weeklyMatch[1], 0, 59, 0)
          .toString()
          .padStart(2, "0");
        const hour = this.clampInt(weeklyMatch[2], 0, 23, 0)
          .toString()
          .padStart(2, "0");
        const day = this.clampInt(weeklyMatch[3], 0, 6, 0);
        return `Weekly on ${weekDayLabels[day]} at ${hour}:${minute}`;
      }

      return `Custom schedule (${cron})`;
    },

    async copyText(value: string, successMessage: string) {
      try {
        await navigator.clipboard.writeText(value);
        this.$eventBus.emit("notify", successMessage);
      } catch (e: any) {
        this.$eventBus.emit(
          "notify",
          `Unable to copy to clipboard (${e.message})`,
          "error",
        );
      }
    },

    copyCron(watcher: any) {
      const cron =
        this.schedulerByWatcher[watcher.id]?.cron || watcher.configuration?.cron;
      if (!cron) {
        return;
      }
      this.copyText(cron, `Copied CRON for watcher ${watcher.name}`);
    },

    copyWatcherEnvVar(watcher: any) {
      const cron =
        this.schedulerByWatcher[watcher.id]?.cron || watcher.configuration?.cron;
      if (!cron) {
        return;
      }
      const watcherName = String(watcher.name || "local")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "_");
      const envVar = `WUD_WATCHER_${watcherName}_CRON=${cron}`;
      this.copyText(envVar, `Copied ${envVar}`);
    },
  },

  async beforeRouteEnter(to, from, next) {
    try {
      const watchers = await getAllWatchers();
      next((vm: any) => {
        vm.watchers = watchers;
        vm.initializeSchedulers(watchers);
      });
    } catch (e: any) {
      next((vm: any) => {
        vm.$eventBus.emit(
          "notify",
          `Error when trying to load the watchers (${e.message})`,
          "error",
        );
      });
    }
  },
});
