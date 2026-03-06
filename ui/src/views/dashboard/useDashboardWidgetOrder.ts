import { onMounted, ref, watch } from 'vue';
import { preferences } from '../../preferences/store';
import { DASHBOARD_WIDGET_IDS, type DashboardWidgetId } from './dashboardTypes';

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value);
}

function sanitizeWidgetOrder(rawOrder: unknown): DashboardWidgetId[] {
  if (!Array.isArray(rawOrder)) {
    return [...DASHBOARD_WIDGET_IDS];
  }

  const seen = new Set<DashboardWidgetId>();
  const normalized: DashboardWidgetId[] = [];
  for (const value of rawOrder) {
    if (!isDashboardWidgetId(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }

  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!seen.has(id)) {
      normalized.push(id);
    }
  }

  return normalized;
}

export function useDashboardWidgetOrder() {
  const widgetOrder = ref<DashboardWidgetId[]>([...DASHBOARD_WIDGET_IDS]);
  const draggedWidgetId = ref<DashboardWidgetId | null>(null);

  function loadWidgetOrder() {
    widgetOrder.value = sanitizeWidgetOrder(preferences.dashboard.widgetOrder);
  }

  function persistWidgetOrder(order: DashboardWidgetId[]) {
    preferences.dashboard.widgetOrder = [...order];
  }

  watch(widgetOrder, persistWidgetOrder);

  function widgetOrderIndex(widgetId: DashboardWidgetId) {
    const index = widgetOrder.value.indexOf(widgetId);
    return index >= 0 ? index : DASHBOARD_WIDGET_IDS.indexOf(widgetId);
  }

  function widgetOrderStyle(widgetId: DashboardWidgetId) {
    return {
      order: widgetOrderIndex(widgetId),
    };
  }

  function moveWidget(draggedId: DashboardWidgetId, targetId: DashboardWidgetId) {
    const nextOrder = [...widgetOrder.value];
    const draggedIndex = nextOrder.indexOf(draggedId);
    const targetIndex = nextOrder.indexOf(targetId);
    if (draggedIndex < 0 || targetIndex < 0) {
      return;
    }

    nextOrder.splice(draggedIndex, 1);
    nextOrder.splice(targetIndex, 0, draggedId);
    widgetOrder.value = nextOrder;
  }

  function onWidgetDragStart(widgetId: DashboardWidgetId, event: DragEvent) {
    draggedWidgetId.value = widgetId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', widgetId);
    }
  }

  function onWidgetDragOver(widgetId: DashboardWidgetId, event: DragEvent) {
    if (!draggedWidgetId.value || draggedWidgetId.value === widgetId) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function onWidgetDrop(widgetId: DashboardWidgetId, event: DragEvent) {
    event.preventDefault();
    const transferWidgetId = event.dataTransfer?.getData('text/plain');
    const draggedId = isDashboardWidgetId(transferWidgetId)
      ? transferWidgetId
      : draggedWidgetId.value;
    if (!draggedId || draggedId === widgetId) {
      draggedWidgetId.value = null;
      return;
    }
    moveWidget(draggedId, widgetId);
    draggedWidgetId.value = null;
  }

  function onWidgetDragEnd() {
    draggedWidgetId.value = null;
  }

  function resetWidgetOrder() {
    widgetOrder.value = [...DASHBOARD_WIDGET_IDS];
  }

  onMounted(() => {
    loadWidgetOrder();
  });

  return {
    draggedWidgetId,
    onWidgetDragEnd,
    onWidgetDragOver,
    onWidgetDragStart,
    onWidgetDrop,
    resetWidgetOrder,
    widgetOrder,
    widgetOrderIndex,
    widgetOrderStyle,
  };
}
