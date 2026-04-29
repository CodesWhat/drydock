<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AppBadge from '../components/AppBadge.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import { useBreakpoints } from '../composables/useBreakpoints';

const { t } = useI18n();
import { useViewMode } from '../preferences/useViewMode';
import type { NotificationRule, NotificationRuleUpdate } from '../services/notification';
import { getAllNotificationRules, updateNotificationRule } from '../services/notification';
import { getAllTriggers } from '../services/trigger';
import type { ApiComponent } from '../types/api';
import { errorMessage } from '../utils/error';

interface TriggerSummary {
  id: string;
  name: string;
  type: string;
}

const NON_NOTIFICATION_TRIGGER_TYPES = new Set(['docker', 'dockercompose']);

function isNotificationTriggerType(type: string) {
  return !NON_NOTIFICATION_TRIGGER_TYPES.has(type.toLowerCase());
}

const notificationsViewMode = useViewMode('notifications');
const loading = ref(true);
const error = ref('');
const saveError = ref('');
const savingRuleId = ref<string | null>(null);
const route = useRoute();

const { isMobile } = useBreakpoints();

const notificationsData = ref<NotificationRule[]>([]);
const triggersData = ref<TriggerSummary[]>([]);
const compactTriggerBadgeClass = 'shrink-0';
const compactTriggerBadgeLabelClass = 'block max-w-[160px] truncate';
const compactTriggerRowClass =
  'flex min-w-0 max-w-full flex-nowrap items-center justify-end gap-1 overflow-x-auto';
const compactTriggerListRowClass =
  'flex min-w-0 max-w-[320px] flex-nowrap items-center justify-end gap-1 overflow-x-auto';

const selectedRuleId = ref<string | null>(null);
const detailOpen = ref(false);
const detailEnabled = ref(true);
const detailTriggers = ref<string[]>([]);

function triggerTypeBadge(type: string) {
  if (type === 'slack')
    return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)', label: 'Slack' };
  if (type === 'discord')
    return { bg: 'var(--dd-alt-muted)', text: 'var(--dd-alt)', label: 'Discord' };
  if (type === 'smtp')
    return { bg: 'var(--dd-success-muted)', text: 'var(--dd-success)', label: 'SMTP' };
  if (type === 'http')
    return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'HTTP' };
  if (type === 'telegram')
    return { bg: 'var(--dd-primary-muted)', text: 'var(--dd-primary)', label: 'Telegram' };
  if (type === 'mqtt')
    return { bg: 'var(--dd-caution-muted)', text: 'var(--dd-caution)', label: 'MQTT' };
  if (type === 'docker' || type === 'dockercompose')
    return {
      bg: 'var(--dd-info-muted)',
      text: 'var(--dd-info)',
      label: type === 'dockercompose' ? 'Compose' : 'Docker',
    };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type };
}

const selectedRule = computed(
  () => notificationsData.value.find((rule) => rule.id === selectedRuleId.value) ?? null,
);

const triggersById = computed(() => {
  const map: Record<string, TriggerSummary> = {};
  triggersData.value.forEach((trigger) => {
    map[trigger.id] = trigger;
  });
  return map;
});

const triggersSorted = computed(() =>
  [...triggersData.value].sort((triggerA, triggerB) => triggerA.name.localeCompare(triggerB.name)),
);

function triggerNameById(id: string) {
  return triggersById.value[id]?.name ?? id;
}

function isImplicitAllTriggersRule(rule: NotificationRule | null | undefined) {
  return rule?.id === 'update-available';
}

function usesImplicitAllTriggers(rule: NotificationRule | null | undefined) {
  return !!rule && isImplicitAllTriggersRule(rule) && rule.triggers.length === 0;
}

function triggerAssignmentSummary(rule: NotificationRule | null | undefined) {
  if (!rule) {
    return '';
  }
  if (usesImplicitAllTriggers(rule)) {
    return t('notificationsView.allNotificationTriggers');
  }
  if (rule.triggers.length === 0) {
    return t('notificationsView.noTriggers');
  }
  return '';
}

function detailTriggerHelpText(rule: NotificationRule | null | undefined) {
  if (!rule) {
    return '';
  }
  if (isImplicitAllTriggersRule(rule)) {
    return t('notificationsView.detail.helpTextImplicitAll');
  }
  return t('notificationsView.detail.helpTextExplicit');
}

function normalizeTriggerIds(triggerIds: string[]) {
  return Array.from(new Set(triggerIds)).sort();
}

function hasTriggerChanges() {
  if (!selectedRule.value) {
    return false;
  }
  const currentTriggers = normalizeTriggerIds(selectedRule.value.triggers);
  const draftTriggers = normalizeTriggerIds(detailTriggers.value);
  if (currentTriggers.length !== draftTriggers.length) {
    return true;
  }
  return currentTriggers.some((triggerId, index) => triggerId !== draftTriggers[index]);
}

const detailHasChanges = computed(() => {
  if (!selectedRule.value) {
    return false;
  }
  return detailEnabled.value !== selectedRule.value.enabled || hasTriggerChanges();
});

const detailSaving = computed(
  () => !!selectedRuleId.value && savingRuleId.value === selectedRuleId.value,
);

const searchQuery = ref('');
const showFilters = ref(false);
const activeFilterCount = computed(() => (searchQuery.value ? 1 : 0));

function applySearchFromQuery(queryValue: unknown) {
  const raw = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  searchQuery.value = typeof raw === 'string' ? raw : '';
}

applySearchFromQuery(route.query.q);
watch(
  () => route.query.q,
  (value) => applySearchFromQuery(value),
);

const filteredNotifications = computed(() => {
  if (!searchQuery.value) return notificationsData.value;
  const q = searchQuery.value.toLowerCase();
  return notificationsData.value.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.triggers.some((triggerId) => triggerNameById(triggerId).toLowerCase().includes(q)),
  );
});

const tableColumns = computed(() => [
  { key: 'enabled', label: t('notificationsView.columns.on'), sortable: false, width: '48px' },
  { key: 'name', label: t('notificationsView.columns.rule'), sortable: false, width: '99%' },
  {
    key: 'triggers',
    label: t('notificationsView.columns.triggers'),
    align: 'text-right',
    sortable: false,
  },
]);

function clearFilters() {
  searchQuery.value = '';
}

function syncDetailDraftFromRule() {
  if (!selectedRule.value) {
    detailEnabled.value = true;
    detailTriggers.value = [];
    return;
  }
  detailEnabled.value = selectedRule.value.enabled;
  detailTriggers.value = [...selectedRule.value.triggers];
}

function openDetail(rule: NotificationRule) {
  selectedRuleId.value = rule.id;
  detailOpen.value = true;
  syncDetailDraftFromRule();
}

function setDetailOpen(nextOpen: boolean) {
  detailOpen.value = nextOpen;
  if (!nextOpen) {
    selectedRuleId.value = null;
    syncDetailDraftFromRule();
  }
}

function updateRuleInList(updatedRule: NotificationRule) {
  const ruleIndex = notificationsData.value.findIndex((rule) => rule.id === updatedRule.id);
  if (ruleIndex < 0) {
    return;
  }
  notificationsData.value[ruleIndex] = {
    ...notificationsData.value[ruleIndex],
    ...updatedRule,
    triggers: [...updatedRule.triggers],
  };
}

async function persistRule(ruleId: string, update: NotificationRuleUpdate) {
  saveError.value = '';
  savingRuleId.value = ruleId;

  try {
    const updatedRule = await updateNotificationRule(ruleId, update);
    updateRuleInList(updatedRule);
    if (selectedRuleId.value === ruleId) {
      syncDetailDraftFromRule();
    }
    return updatedRule;
  } catch (e: unknown) {
    saveError.value = errorMessage(e, 'Failed to update notification rule');
    throw e;
  } finally {
    savingRuleId.value = null;
  }
}

async function toggleNotification(ruleId: string) {
  if (savingRuleId.value) {
    return;
  }
  const rule = notificationsData.value.find((item) => item.id === ruleId);
  if (!rule) {
    return;
  }

  const enabledCurrent = rule.enabled;
  rule.enabled = !enabledCurrent;

  try {
    await persistRule(ruleId, { enabled: rule.enabled });
  } catch {
    rule.enabled = enabledCurrent;
    if (selectedRuleId.value === ruleId) {
      detailEnabled.value = enabledCurrent;
    }
  }
}

function isTriggerSelected(triggerId: string) {
  return detailTriggers.value.includes(triggerId);
}

function toggleDetailTrigger(triggerId: string) {
  if (isTriggerSelected(triggerId)) {
    detailTriggers.value = detailTriggers.value.filter((id) => id !== triggerId);
    return;
  }
  detailTriggers.value = [...detailTriggers.value, triggerId].sort();
}

async function saveSelectedRule() {
  if (!selectedRule.value || !detailHasChanges.value || detailSaving.value) {
    return;
  }

  const update: NotificationRuleUpdate = {};
  if (detailEnabled.value !== selectedRule.value.enabled) {
    update.enabled = detailEnabled.value;
  }
  if (hasTriggerChanges()) {
    update.triggers = normalizeTriggerIds(detailTriggers.value);
  }

  await persistRule(selectedRule.value.id, update);
}

onMounted(async () => {
  try {
    const [notificationRules, triggers] = await Promise.all([
      getAllNotificationRules(),
      getAllTriggers(),
    ]);

    const notificationTriggers: TriggerSummary[] = triggers
      .filter((trigger: ApiComponent) => isNotificationTriggerType(trigger.type))
      .map((trigger: ApiComponent) => ({
        id: trigger.id,
        name: trigger.name,
        type: trigger.type,
      }));
    const allowedTriggerIds = new Set(notificationTriggers.map((trigger) => trigger.id));

    notificationsData.value = notificationRules.map((rule: NotificationRule) => ({
      ...rule,
      triggers: normalizeTriggerIds(
        rule.triggers.filter((triggerId) => allowedTriggerIds.has(triggerId)),
      ),
    }));
    triggersData.value = notificationTriggers;
  } catch (e: unknown) {
    error.value = errorMessage(e, t('notificationsView.loadError'));
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DataViewLayout>
    <div v-if="error"
         class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="saveError"
         class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ saveError }}
    </div>

    <DataFilterBar
      v-model="notificationsViewMode"
      v-model:showFilters="showFilters"
      :filtered-count="filteredNotifications.length"
      :total-count="notificationsData.length"
      :active-filter-count="activeFilterCount">
      <template #filters>
        <input v-model="searchQuery"
               type="text"
               :placeholder="t('notificationsView.filterPlaceholder')"
               class="flex-1 min-w-[120px] max-w-[320px] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
        <AppButton size="none" variant="text-muted" weight="medium" class="text-2xs" v-if="searchQuery"

                @click="clearFilters">
          {{ t('notificationsView.clear') }}
        </AppButton>
      </template>
    </DataFilterBar>

    <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">{{ t('notificationsView.loadingRules') }}</div>

    <DataTable
      v-if="notificationsViewMode === 'table' && !loading"
      :columns="tableColumns"
      :rows="filteredNotifications"
      row-key="id"
      :active-row="selectedRule?.id"
      @row-click="openDetail($event)">
      <template #cell-enabled="{ row }">
        <ToggleSwitch
          :model-value="row.enabled"
          size="sm"
          class="mx-auto shrink-0"
          :disabled="savingRuleId === row.id"
          :aria-label="t('notificationsView.toggleAriaLabel')"
          on-color="var(--dd-success)"
          off-color="var(--dd-border-strong)"
          @click.stop
          @update:model-value="toggleNotification(row.id)"
        />
      </template>
      <template #cell-name="{ row }">
        <div class="font-medium truncate dd-text" :title="row.name" v-tooltip.top="row.name">{{ row.name }}</div>
        <div class="text-2xs mt-0.5 dd-text-muted truncate"
             :title="row.description"
             v-tooltip.top="row.description">
          {{ row.description }}
        </div>
      </template>
      <template #cell-triggers="{ row }">
        <div :class="compactTriggerRowClass">
          <AppBadge v-for="triggerId in row.triggers" :key="triggerId"
                    :custom="{ bg: 'var(--dd-neutral-muted)', text: 'var(--dd-text-secondary)' }"
                    size="xs"
                    :uppercase="false"
                    :title="triggerNameById(triggerId)"
                    v-tooltip.top="triggerNameById(triggerId)"
                    :class="compactTriggerBadgeClass">
            <span :class="compactTriggerBadgeLabelClass">{{ triggerNameById(triggerId) }}</span>
          </AppBadge>
          <span v-if="triggerAssignmentSummary(row)" class="text-2xs italic dd-text-muted shrink-0 whitespace-nowrap">
            {{ triggerAssignmentSummary(row) }}
          </span>
        </div>
      </template>
      <template #empty>
        <EmptyState icon="notifications"
                    :message="t('notificationsView.emptyFiltered')"
                    :show-clear="activeFilterCount > 0"
                    @clear="clearFilters" />
      </template>
    </DataTable>

    <DataCardGrid
      v-if="notificationsViewMode === 'cards' && !loading && filteredNotifications.length > 0"
      :items="filteredNotifications"
      item-key="id"
      :selected-key="selectedRule?.id"
      @item-click="openDetail($event)">
      <template #card="{ item: notif }">
        <div class="px-4 pt-4 pb-2 flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-sm-plus font-semibold truncate dd-text" :title="notif.name" v-tooltip.top="notif.name">{{ notif.name }}</div>
            <div class="text-2xs-plus mt-0.5 dd-text-muted truncate"
                 :title="notif.description"
                 v-tooltip.top="notif.description">
              {{ notif.description }}
            </div>
          </div>
          <ToggleSwitch
            :model-value="notif.enabled"
            size="sm"
            class="shrink-0"
            :disabled="savingRuleId === notif.id"
            :aria-label="t('notificationsView.toggleAriaLabel')"
            on-color="var(--dd-success)"
            off-color="var(--dd-border-strong)"
            @click.stop
            @update:model-value="toggleNotification(notif.id)"
          />
        </div>
        <div :class="['px-4 py-2.5 mt-auto', compactTriggerRowClass]"
             :style="{ borderTop: '1px solid var(--dd-border)', backgroundColor: 'var(--dd-bg-elevated)' }">
          <AppBadge v-for="triggerId in notif.triggers" :key="triggerId"
                    :custom="{ bg: 'var(--dd-neutral-muted)', text: 'var(--dd-text-secondary)' }"
                    size="xs"
                    :uppercase="false"
                    :title="triggerNameById(triggerId)"
                    v-tooltip.top="triggerNameById(triggerId)"
                    :class="compactTriggerBadgeClass">
            <span :class="compactTriggerBadgeLabelClass">{{ triggerNameById(triggerId) }}</span>
          </AppBadge>
          <span v-if="triggerAssignmentSummary(notif)" class="text-2xs italic dd-text-muted shrink-0 whitespace-nowrap">
            {{ triggerAssignmentSummary(notif) }}
          </span>
        </div>
      </template>
    </DataCardGrid>

    <DataListAccordion
      v-if="notificationsViewMode === 'list' && !loading && filteredNotifications.length > 0"
      :items="filteredNotifications"
      item-key="id"
      :selected-key="selectedRule?.id"
      @item-click="openDetail($event)">
      <template #header="{ item: notif }">
        <ToggleSwitch
          :model-value="notif.enabled"
          size="sm"
          class="shrink-0"
          :disabled="savingRuleId === notif.id"
          :aria-label="t('notificationsView.toggleAriaLabel')"
          on-color="var(--dd-success)"
          off-color="var(--dd-border-strong)"
          @click.stop
          @update:model-value="toggleNotification(notif.id)"
        />
        <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ notif.name }}</span>
        <div :class="compactTriggerListRowClass">
          <AppBadge v-for="triggerId in notif.triggers" :key="triggerId"
                    :custom="{ bg: 'var(--dd-neutral-muted)', text: 'var(--dd-text-secondary)' }"
                    size="xs"
                    :uppercase="false"
                    :title="triggerNameById(triggerId)"
                    v-tooltip.top="triggerNameById(triggerId)"
                    :class="compactTriggerBadgeClass">
            <span :class="compactTriggerBadgeLabelClass">{{ triggerNameById(triggerId) }}</span>
          </AppBadge>
          <span v-if="triggerAssignmentSummary(notif)" class="text-2xs italic dd-text-muted shrink-0 whitespace-nowrap">
            {{ triggerAssignmentSummary(notif) }}
          </span>
        </div>
      </template>
      <template #details="{ item: notif }">
        <div class="text-2xs-plus dd-text-muted">{{ notif.description }}</div>
      </template>
    </DataListAccordion>

    <EmptyState
      v-if="(notificationsViewMode === 'cards' || notificationsViewMode === 'list') && !loading && filteredNotifications.length === 0"
      icon="notifications"
      :message="t('notificationsView.emptyFiltered')"
      :show-clear="activeFilterCount > 0"
      @clear="clearFilters" />

    <template #panel>
      <DetailPanel
        :open="detailOpen"
        :is-mobile="isMobile"
        :show-size-controls="false"
        :show-full-page="false"
        @update:open="setDetailOpen($event)">
        <template #header>
          <div class="flex items-center gap-2.5 min-w-0">
            <AppIcon name="notifications" :size="14" class="dd-text-secondary" />
            <span class="text-sm font-bold truncate dd-text">{{ selectedRule?.name }}</span>
          </div>
        </template>

        <template #subtitle>
          <AppBadge v-if="selectedRule" :tone="selectedRule.enabled ? 'success' : 'neutral'" size="xs">
            {{ selectedRule.enabled ? t('notificationsView.detail.enabled') : t('notificationsView.detail.disabled') }}
          </AppBadge>
          <span v-if="selectedRule"
                class="text-2xs font-mono dd-text-muted truncate max-w-full"
                :title="selectedRule.id"
                v-tooltip.top="selectedRule.id">
            {{ selectedRule.id }}
          </span>
        </template>

        <template v-if="selectedRule" #default>
          <div class="p-4 space-y-5">
            <div class="text-2xs-plus dd-text-muted">{{ selectedRule.description }}</div>

            <div>
              <div class="text-2xs font-semibold uppercase tracking-wider mb-2 dd-text-muted">{{ t('notificationsView.detail.ruleStatusLabel') }}</div>
              <ToggleSwitch
                :model-value="detailEnabled"
                :disabled="detailSaving"
                :aria-label="t('notificationsView.detail.ruleStatusAriaLabel')"
                on-color="var(--dd-success)"
                off-color="var(--dd-border-strong)"
                @update:model-value="detailEnabled = $event"
              />
              <div class="text-2xs mt-1 dd-text-muted">
                {{ detailEnabled ? t('notificationsView.detail.enabledText') : t('notificationsView.detail.disabledText') }}
              </div>
            </div>

            <div>
              <div class="text-2xs font-semibold uppercase tracking-wider mb-2 dd-text-muted">
                {{ t('notificationsView.detail.assignedTriggersLabel') }}
              </div>
              <div class="text-2xs-plus mb-2 dd-text-muted">
                {{ detailTriggerHelpText(selectedRule) }}
              </div>
              <div v-if="triggersSorted.length === 0" class="text-2xs-plus dd-text-muted">
                {{ t('notificationsView.detail.noTriggersConfigured') }} <RouterLink to="/triggers"
                class="underline hover:no-underline">{{ t('notificationsView.detail.triggersPageLink') }}</RouterLink>.
              </div>
              <div v-else class="space-y-2">
                <label v-for="trigger in triggersSorted" :key="trigger.id"
                       class="flex items-center gap-2.5 px-2.5 py-2 dd-rounded cursor-pointer"
                       :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
                  <input type="checkbox"
                         :checked="isTriggerSelected(trigger.id)"
                         :disabled="detailSaving"
                         @change="toggleDetailTrigger(trigger.id)" />
                  <div class="flex-1 min-w-0">
                    <div class="text-xs font-semibold truncate dd-text">{{ trigger.name }}</div>
                    <div class="text-2xs font-mono dd-text-muted truncate"
                         :title="trigger.id"
                         v-tooltip.top="trigger.id">
                      {{ trigger.id }}
                    </div>
                  </div>
                  <AppBadge :custom="{ bg: triggerTypeBadge(trigger.type).bg, text: triggerTypeBadge(trigger.type).text }" size="xs" class="shrink-0">
                    {{ triggerTypeBadge(trigger.type).label }}
                  </AppBadge>
                </label>
              </div>
            </div>

            <div class="pt-2 flex items-center gap-2">
              <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none"
                      :style="{ backgroundColor: 'var(--dd-primary)', color: 'white' }"
                      :disabled="detailSaving || !detailHasChanges"
                      @click="saveSelectedRule">
                <AppIcon :name="detailSaving ? 'pending' : 'check'" :size="12" />
                {{ detailSaving ? t('notificationsView.detail.saving') : t('notificationsView.detail.saveChanges') }}
              </AppButton>
              <AppButton size="none" variant="plain" weight="none" class="px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated disabled:opacity-50 disabled:pointer-events-none"
                      :disabled="detailSaving || !detailHasChanges"
                      @click="syncDetailDraftFromRule">
                {{ t('notificationsView.detail.reset') }}
              </AppButton>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
