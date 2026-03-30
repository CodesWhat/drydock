import { computed, ref, watch } from 'vue';
import type { Container } from '../types/container';
import { useSessionStorageItem } from './useSessionStorageItem';

interface DetailPanelState {
  name: string;
  tab: string;
  panel: boolean;
  full: boolean;
  size: 'sm' | 'md' | 'lg';
}

const DETAIL_PANEL_KEY = 'dd-panel';
const PANEL_SIZES = new Set<DetailPanelState['size']>(['sm', 'md', 'lg']);

export function isDetailPanelState(value: unknown): value is DetailPanelState {
  if (typeof value !== 'object' || value === null) return false;
  if (!('name' in value) || typeof value.name !== 'string') return false;
  if (!('tab' in value) || typeof value.tab !== 'string') return false;
  if (!('panel' in value) || typeof value.panel !== 'boolean') return false;
  if (!('full' in value) || typeof value.full !== 'boolean') return false;
  if (!('size' in value) || typeof value.size !== 'string') return false;
  return PANEL_SIZES.has(value.size as DetailPanelState['size']);
}

export function useDetailPanelStorage() {
  return useSessionStorageItem<DetailPanelState>(DETAIL_PANEL_KEY, isDetailPanelState);
}

export function useDetailPanel() {
  const panelStorage = useDetailPanelStorage();
  const selectedContainer = ref<Container | null>(null);
  const detailPanelOpen = ref(false);
  const activeDetailTab = ref('overview');
  const panelSize = ref<'sm' | 'md' | 'lg'>('sm');
  const containerFullPage = ref(false);

  const panelFlex = computed(() =>
    panelSize.value === 'sm'
      ? '0 0 var(--dd-layout-panel-width-sm)'
      : panelSize.value === 'md'
        ? '0 0 var(--dd-layout-panel-width-md)'
        : '0 0 var(--dd-layout-panel-width-lg)',
  );

  const detailTabs = [
    { id: 'overview', label: 'Overview', icon: 'info' },
    { id: 'stats', label: 'Stats', icon: 'uptime' },
    { id: 'logs', label: 'Logs', icon: 'logs' },
    { id: 'environment', label: 'Environment', icon: 'config' },
    { id: 'labels', label: 'Labels', icon: 'containers' },
    { id: 'actions', label: 'Actions', icon: 'triggers' },
  ];

  function savePanelState() {
    if (selectedContainer.value) {
      panelStorage.write({
        name: selectedContainer.value.name,
        tab: activeDetailTab.value,
        panel: detailPanelOpen.value,
        full: containerFullPage.value,
        size: panelSize.value,
      });
    } else {
      panelStorage.remove();
    }
  }

  function selectContainer(c: Container) {
    selectedContainer.value = c;
    activeDetailTab.value = 'overview';
    detailPanelOpen.value = true;
    savePanelState();
  }

  function openFullPage() {
    containerFullPage.value = true;
    detailPanelOpen.value = false;
    savePanelState();
  }

  function closeFullPage() {
    containerFullPage.value = false;
    savePanelState();
  }

  function closePanel() {
    detailPanelOpen.value = false;
    panelSize.value = 'sm';
    selectedContainer.value = null;
    panelStorage.remove();
  }

  watch([activeDetailTab, panelSize], savePanelState);

  return {
    selectedContainer,
    detailPanelOpen,
    activeDetailTab,
    panelSize,
    containerFullPage,
    panelFlex,
    detailTabs,
    selectContainer,
    openFullPage,
    closeFullPage,
    closePanel,
  };
}
