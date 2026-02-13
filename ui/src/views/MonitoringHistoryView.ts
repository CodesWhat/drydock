import { defineComponent } from 'vue';
import { useDisplay } from 'vuetify';
import { getAuditLog } from '@/services/audit';

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  containerName: string;
  containerImage?: string;
  fromVersion?: string;
  toVersion?: string;
  triggerName?: string;
  status: 'success' | 'error' | 'info';
  details?: string;
}

interface AuditLogParams {
  page: number;
  limit: number;
  action?: string;
  container?: string;
}

export default defineComponent({
  setup() {
    const { smAndUp, mdAndUp } = useDisplay();
    return { smAndUp, mdAndUp };
  },
  data() {
    return {
      loading: false,
      error: '',
      entries: [] as AuditEntry[],
      total: 0,
      currentPage: 1,
      pageSize: 20,
      showFilters: false,
      filterAction: null as string | null,
      filterContainer: '',
      actionOptions: [
        { title: 'Update Available', value: 'update-available' },
        { title: 'Update Applied', value: 'update-applied' },
        { title: 'Update Failed', value: 'update-failed' },
        { title: 'Container Added', value: 'container-added' },
        { title: 'Container Removed', value: 'container-removed' },
        { title: 'Rollback', value: 'rollback' },
        { title: 'Preview', value: 'preview' },
      ],
    };
  },
  computed: {
    totalPages(): number {
      return Math.max(1, Math.ceil(this.total / this.pageSize));
    },
    activeFilterCount(): number {
      let count = 0;
      if (this.filterAction) count++;
      if (this.filterContainer) count++;
      return count;
    },
  },
  watch: {
    currentPage() {
      this.fetchEntries();
    },
    filterAction() {
      this.currentPage = 1;
      this.fetchEntries();
    },
    filterContainer() {
      this.currentPage = 1;
      this.fetchEntries();
    },
  },
  methods: {
    async fetchEntries() {
      this.loading = true;
      this.error = '';
      try {
        const params: AuditLogParams = {
          page: this.currentPage,
          limit: this.pageSize,
        };
        if (this.filterAction) params.action = this.filterAction;
        if (this.filterContainer) params.container = this.filterContainer;
        const result = await getAuditLog(params);
        this.entries = result.entries || [];
        this.total = result.total || 0;
      } catch (e: unknown) {
        this.error = e instanceof Error ? e.message : 'Failed to fetch audit log';
      } finally {
        this.loading = false;
      }
    },
    formatTimestamp(ts: string): string {
      if (!ts) return '-';
      const d = new Date(ts);
      if (!this.smAndUp) {
        // Short format for mobile: "Feb 13 11:44"
        const month = d.toLocaleString('en', { month: 'short' });
        const day = d.getDate();
        const time = d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
        return `${month} ${day} ${time}`;
      }
      return d.toLocaleString();
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
    statusColor(status: string): string {
      const map: Record<string, string> = {
        success: 'success',
        error: 'error',
        info: 'info',
      };
      return map[status] || 'default';
    },
  },
  mounted() {
    this.fetchEntries();
  },
});
