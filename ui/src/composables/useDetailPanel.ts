import { computed, ref, watch } from 'vue';
import type { Container } from '../types/container';

export function useDetailPanel() {
  const selectedContainer = ref<Container | null>(null);
  const detailPanelOpen = ref(false);
  const activeDetailTab = ref('overview');
  const panelSize = ref<'sm' | 'md' | 'lg'>('sm');
  const containerFullPage = ref(false);

  const panelFlex = computed(() =>
    panelSize.value === 'sm' ? '0 0 30%' : panelSize.value === 'md' ? '0 0 45%' : '0 0 70%',
  );

  const detailTabs = [
    { id: 'overview', label: 'Overview', icon: 'info' },
    { id: 'logs', label: 'Logs', icon: 'logs' },
    { id: 'environment', label: 'Environment', icon: 'config' },
    { id: 'labels', label: 'Labels', icon: 'containers' },
  ];

  function savePanelState() {
    if (selectedContainer.value) {
      sessionStorage.setItem(
        'dd-panel',
        JSON.stringify({
          name: selectedContainer.value.name,
          tab: activeDetailTab.value,
          panel: detailPanelOpen.value,
          full: containerFullPage.value,
          size: panelSize.value,
        }),
      );
    } else {
      sessionStorage.removeItem('dd-panel');
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
    sessionStorage.removeItem('dd-panel');
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
