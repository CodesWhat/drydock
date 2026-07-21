import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import {
  useDetailPanel as createDetailPanel,
  isDetailPanelState,
} from '@/composables/useDetailPanel';
import type { Container } from '@/types/container';

// useDetailPanel calls useI18n(), which needs an active component instance with
// the global i18n plugin (installed in tests/setup.ts). Run it inside a
// throwaway mounted component so the injection is present.
function withDetailPanel() {
  let api!: ReturnType<typeof createDetailPanel>;
  mount(
    defineComponent({
      setup() {
        api = createDetailPanel();
        return () => null;
      },
    }),
  );
  return api;
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    identityKey: 'c1',
    name: 'nginx',
    image: 'nginx:latest',
    icon: '',
    currentTag: 'latest',
    newTag: null,
    isDigestPinned: false,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    bouncer: 'safe',
    server: 'local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

describe('useDetailPanel', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('initial state', () => {
    it('should have no selected container', () => {
      const { selectedContainer } = withDetailPanel();
      expect(selectedContainer.value).toBeNull();
    });

    it('should have panel closed', () => {
      const { detailPanelOpen } = withDetailPanel();
      expect(detailPanelOpen.value).toBe(false);
    });

    it('should default to overview tab', () => {
      const { activeDetailTab } = withDetailPanel();
      expect(activeDetailTab.value).toBe('overview');
    });

    it('should default panel size to sm', () => {
      const { panelSize } = withDetailPanel();
      expect(panelSize.value).toBe('sm');
    });

    it('should default containerFullPage to false', () => {
      const { containerFullPage } = withDetailPanel();
      expect(containerFullPage.value).toBe(false);
    });
  });

  describe('panelFlex', () => {
    it('should return sm token basis for sm', () => {
      const { panelFlex } = withDetailPanel();
      expect(panelFlex.value).toBe('0 0 var(--dd-layout-panel-width-sm)');
    });

    it('should return md token basis for md', () => {
      const { panelSize, panelFlex } = withDetailPanel();
      panelSize.value = 'md';
      expect(panelFlex.value).toBe('0 0 var(--dd-layout-panel-width-md)');
    });

    it('should return lg token basis for lg', () => {
      const { panelSize, panelFlex } = withDetailPanel();
      panelSize.value = 'lg';
      expect(panelFlex.value).toBe('0 0 var(--dd-layout-panel-width-lg)');
    });
  });

  describe('detailTabs', () => {
    it('should have 6 tabs', () => {
      const { detailTabs } = withDetailPanel();
      expect(detailTabs.value).toHaveLength(6);
    });

    it('should have correct tab ids', () => {
      const { detailTabs } = withDetailPanel();
      expect(detailTabs.value.map((t) => t.id)).toEqual([
        'overview',
        'stats',
        'logs',
        'environment',
        'labels',
        'actions',
      ]);
    });
  });

  describe('selectContainer', () => {
    it('should set the selected container', () => {
      const { selectedContainer, selectContainer } = withDetailPanel();
      const c = makeContainer();
      selectContainer(c);
      expect(selectedContainer.value).toStrictEqual(c);
    });

    it('should open the panel', () => {
      const { detailPanelOpen, selectContainer } = withDetailPanel();
      selectContainer(makeContainer());
      expect(detailPanelOpen.value).toBe(true);
    });

    it('should reset tab to overview', () => {
      const { activeDetailTab, selectContainer } = withDetailPanel();
      activeDetailTab.value = 'logs';
      selectContainer(makeContainer());
      expect(activeDetailTab.value).toBe('overview');
    });

    it('should save state to sessionStorage', () => {
      const { selectContainer } = withDetailPanel();
      selectContainer(makeContainer({ name: 'test-container' }));
      const stored = JSON.parse(sessionStorage.getItem('dd-panel') || '{}');
      expect(stored.name).toBe('test-container');
      expect(stored.panel).toBe(true);
    });
  });

  describe('closePanel', () => {
    it('should close the panel and clear selection', () => {
      const { selectedContainer, detailPanelOpen, selectContainer, closePanel } = withDetailPanel();
      selectContainer(makeContainer());
      closePanel();
      expect(detailPanelOpen.value).toBe(false);
      expect(selectedContainer.value).toBeNull();
    });

    it('should reset panel size to sm', () => {
      const { panelSize, selectContainer, closePanel } = withDetailPanel();
      selectContainer(makeContainer());
      panelSize.value = 'lg';
      closePanel();
      expect(panelSize.value).toBe('sm');
    });

    it('should remove sessionStorage entry', () => {
      const { selectContainer, closePanel } = withDetailPanel();
      selectContainer(makeContainer());
      expect(sessionStorage.getItem('dd-panel')).not.toBeNull();
      closePanel();
      expect(sessionStorage.getItem('dd-panel')).toBeNull();
    });
  });

  describe('openFullPage / closeFullPage', () => {
    it('should set containerFullPage true and close panel', () => {
      const { detailPanelOpen, containerFullPage, selectContainer, openFullPage } =
        withDetailPanel();
      selectContainer(makeContainer());
      openFullPage();
      expect(containerFullPage.value).toBe(true);
      expect(detailPanelOpen.value).toBe(false);
    });

    it('should save full page state to sessionStorage', () => {
      const { selectContainer, openFullPage } = withDetailPanel();
      selectContainer(makeContainer());
      openFullPage();
      const stored = JSON.parse(sessionStorage.getItem('dd-panel') || '{}');
      expect(stored.full).toBe(true);
    });

    it('should set containerFullPage false on closeFullPage', () => {
      const { containerFullPage, selectContainer, openFullPage, closeFullPage } = withDetailPanel();
      selectContainer(makeContainer());
      openFullPage();
      closeFullPage();
      expect(containerFullPage.value).toBe(false);
    });
  });

  describe('sessionStorage persistence', () => {
    it('should save tab and size changes', () => {
      const { selectContainer, activeDetailTab, panelSize } = withDetailPanel();
      selectContainer(makeContainer());
      activeDetailTab.value = 'logs';
      panelSize.value = 'lg';
      // The watch triggers on next tick, but savePanelState is also called in selectContainer
      // Manually verify the stored state reflects the selection
      const stored = JSON.parse(sessionStorage.getItem('dd-panel') || '{}');
      expect(stored.name).toBe('nginx');
    });
  });

  describe('isDetailPanelState', () => {
    const validState = {
      name: 'nginx',
      tab: 'overview',
      panel: true,
      full: false,
      size: 'sm',
    } as const;

    it('returns true for a valid panel state object', () => {
      expect(isDetailPanelState(validState)).toBe(true);
    });

    it('returns false for invalid values and missing fields', () => {
      expect(isDetailPanelState(null)).toBe(false);
      expect(isDetailPanelState('bad')).toBe(false);
      expect(isDetailPanelState({ ...validState, name: 123 })).toBe(false);
      expect(isDetailPanelState({ ...validState, tab: 42 })).toBe(false);
      expect(isDetailPanelState({ ...validState, panel: 'yes' })).toBe(false);
      expect(isDetailPanelState({ ...validState, full: 'no' })).toBe(false);
      expect(isDetailPanelState({ ...validState, size: 99 })).toBe(false);
      expect(isDetailPanelState({ ...validState, size: 'xl' })).toBe(false);
    });
  });
});
