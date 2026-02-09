import IconRenderer from "@/components/IconRenderer.vue";
import { defineComponent } from "vue";
import { useDisplay } from "vuetify";

export default defineComponent({
  setup() {
    const { smAndUp } = useDisplay();
    return { smAndUp };
  },
  components: {
    IconRenderer,
  },
  props: {
    item: {
      type: Object,
      required: true,
    },
    agents: {
      type: Array,
      required: false,
      default: () => [],
    },
  },
  data() {
    return {
      showDetail: false,
    };
  },
  computed: {
    agentStatusColor() {
      const agent = (this.agents as any[]).find(
        (a) => a.name === this.item.agent,
      );
      if (agent) {
        return agent.connected ? "success" : "error";
      }
      return "info";
    },

    configurationItems() {
      return Object.keys(this.item.configuration || [])
        .map((key) => ({
          key,
          value: this.item.configuration[key],
        }))
        .sort((item1, item2) => item1.key.localeCompare(item2.key));
    },

    displayName() {
      if (
        this.item.name &&
        this.item.type &&
        this.item.name !== this.item.type
      ) {
        return `${this.item.name} (${this.item.type})`;
      }
      if (this.item.name) {
        return this.item.name;
      }
      return "Unknown";
    },
  },

  methods: {
    collapse() {
      this.showDetail = !this.showDetail;
    },
    formatValue(value: any) {
      if (value === undefined || value === null || value === "") {
        return "<empty>";
      }
      return value;
    },
  },
});
