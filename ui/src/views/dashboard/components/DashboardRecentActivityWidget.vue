<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import {
  actionIcon,
  actionLabel,
  type AuditEntry,
  statusBg,
  statusColor,
  timeAgo,
} from '../../../utils/audit-helpers';

interface Props {
  editMode: boolean;
  entries: AuditEntry[];
  error: string | null;
  loading: boolean;
}

defineProps<Props>();

const { t, te, locale } = useI18n();

const emit = defineEmits<{
  viewAll: [];
  openEntry: [entry: AuditEntry];
}>();

function actor(entry: AuditEntry): string {
  return entry.triggerName || t('dashboardView.recentActivity.system');
}
</script>

<template>
  <div
    :aria-label="t('dashboardView.recentActivity.title')"
    class="dashboard-widget dd-rounded overflow-hidden flex flex-col"
    :style="{ backgroundColor: 'var(--dd-bg-card)' }">
    <div class="shrink-0 flex items-center justify-between px-5 py-3.5" :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <div class="flex items-center gap-2">
        <div v-if="editMode" class="drag-handle dd-drag-handle" v-tooltip.top="t('dashboardView.dragToReorder')"><AppIcon name="ph:dots-six-vertical" :size="14" /></div>
        <AppIcon name="audit" :size="14" class="text-drydock-secondary" />
        <h2 class="dd-text-heading-section dd-text">{{ t('dashboardView.recentActivity.title') }}</h2>
      </div>
      <AppButton size="compact" variant="link-secondary" weight="medium" class="text-2xs-plus" @click="emit('viewAll')">{{ t('dashboardView.recentActivity.viewAudit') }}</AppButton>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain dd-scroll-stable p-4 space-y-2">
      <div v-if="loading" class="text-2xs-plus dd-text-muted">{{ t('dashboardView.recentActivity.loading') }}</div>
      <div v-else-if="error && entries.length === 0" class="text-2xs-plus dd-text-danger">{{ t('dashboardView.recentActivity.loadFailed') }}</div>
      <div v-else-if="entries.length === 0" class="text-2xs-plus dd-text-muted">{{ t('dashboardView.recentActivity.empty') }}</div>
      <template v-else>
        <div
          v-for="entry in entries"
          :key="entry.id"
          data-activity-row
          class="flex items-center gap-3 p-2.5 dd-rounded cursor-pointer transition-colors hover:dd-bg-elevated"
          :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
          @click="emit('openEntry', entry)">
          <div
            class="w-7 h-7 shrink-0 dd-rounded flex items-center justify-center"
            :style="{ backgroundColor: statusBg(entry.status), color: statusColor(entry.status) }">
            <AppIcon :name="actionIcon(entry.action)" :size="14" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-semibold truncate dd-text">
              {{ actionLabel(entry.action, { t, te }) }}
              <span class="font-normal dd-text-muted">{{ entry.containerName }}</span>
            </div>
            <div class="text-2xs dd-text-muted truncate">{{ actor(entry) }}</div>
          </div>
          <span class="shrink-0 text-2xs dd-text-muted" :title="entry.timestamp">{{ timeAgo(entry.timestamp, locale, t) }}</span>
        </div>
      </template>
    </div>
  </div>
</template>
