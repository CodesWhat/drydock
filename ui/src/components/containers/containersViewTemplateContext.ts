import type { ComputedRef, InjectionKey, Ref, WritableComputedRef } from 'vue';
import { inject } from 'vue';
import type { useBreakpoints } from '../../composables/useBreakpoints';
import type { useColumnVisibility } from '../../composables/useColumnVisibility';
import type { useContainerFilters } from '../../composables/useContainerFilters';
import type { useDetailPanel } from '../../composables/useDetailPanel';
import type { LogAutoFetchIntervalOption } from '../../composables/useLogViewerBehavior';
import type { PreferencesSchema } from '../../preferences/schema';
import type { useViewMode } from '../../preferences/useViewMode';
import type { Container } from '../../types/container';
import type {
  parseServer,
  registryColorBg,
  registryColorText,
  registryLabel,
  serverBadgeColor,
  updateKindColor,
} from '../../utils/display';
import type { useContainerActions } from '../../views/containers/useContainerActions';
import type { useContainerLogs } from '../../views/containers/useContainerLogs';
import type { useContainerSecurity } from '../../views/containers/useContainerSecurity';

type ContainerFiltersContext = Pick<
  ReturnType<typeof useContainerFilters>,
  | 'filterSearch'
  | 'filterStatus'
  | 'filterBouncer'
  | 'filterRegistry'
  | 'filterServer'
  | 'filterKind'
  | 'showFilters'
  | 'activeFilterCount'
  | 'filteredContainers'
  | 'clearFilters'
>;

type ColumnVisibilityContext = Pick<
  ReturnType<typeof useColumnVisibility>,
  'showColumnPicker' | 'allColumns' | 'toggleColumn' | 'visibleColumns'
>;

type DetailPanelContext = Pick<
  ReturnType<typeof useDetailPanel>,
  | 'selectedContainer'
  | 'detailPanelOpen'
  | 'activeDetailTab'
  | 'panelSize'
  | 'detailTabs'
  | 'selectContainer'
  | 'openFullPage'
  | 'closeFullPage'
  | 'closePanel'
>;

type ContainerLogsContext = Pick<
  ReturnType<typeof useContainerLogs>,
  | 'containerAutoFetchInterval'
  | 'getContainerLogs'
  | 'containerLogRef'
  | 'containerHandleLogScroll'
  | 'containerScrollBlocked'
  | 'containerResumeAutoScroll'
>;

type ContainerSecurityContext = Pick<
  ReturnType<typeof useContainerSecurity>,
  | 'selectedRuntimeOrigins'
  | 'runtimeOriginStyle'
  | 'runtimeOriginLabel'
  | 'selectedRuntimeDriftWarnings'
  | 'selectedLifecycleHooks'
  | 'lifecycleHookTemplateVariables'
  | 'selectedAutoRollbackConfig'
  | 'selectedImageMetadata'
  | 'detailVulnerabilityLoading'
  | 'detailSbomLoading'
  | 'loadDetailSecurityData'
  | 'detailVulnerabilityError'
  | 'vulnerabilitySummary'
  | 'vulnerabilityTotal'
  | 'vulnerabilityPreview'
  | 'severityStyle'
  | 'normalizeSeverity'
  | 'getVulnerabilityPackage'
  | 'selectedSbomFormat'
  | 'loadDetailSbom'
  | 'detailSbomError'
  | 'sbomDocument'
  | 'sbomComponentCount'
  | 'sbomGeneratedAt'
>;

type ContainerActionsContext = Pick<
  ReturnType<typeof useContainerActions>,
  | 'actionInProgress'
  | 'confirmDelete'
  | 'confirmForceUpdate'
  | 'confirmRollback'
  | 'confirmRestart'
  | 'confirmStop'
  | 'containerPolicyTooltip'
  | 'detailBackups'
  | 'detailPreview'
  | 'detailTriggers'
  | 'detailUpdateOperations'
  | 'formatOperationPhase'
  | 'formatOperationStatus'
  | 'formatRollbackReason'
  | 'formatTimestamp'
  | 'getContainerListPolicyState'
  | 'getOperationStatusStyle'
  | 'getTriggerKey'
  | 'groupUpdateInProgress'
  | 'policyError'
  | 'policyInProgress'
  | 'policyMessage'
  | 'previewError'
  | 'previewLoading'
  | 'removeSkipDigestSelected'
  | 'removeSkipTagSelected'
  | 'rollbackError'
  | 'rollbackInProgress'
  | 'rollbackMessage'
  | 'rollbackToBackup'
  | 'runAssociatedTrigger'
  | 'runContainerPreview'
  | 'scanContainer'
  | 'selectedSkipDigests'
  | 'selectedSkipTags'
  | 'selectedSnoozeUntil'
  | 'selectedUpdatePolicy'
  | 'skipCurrentForSelected'
  | 'skipUpdate'
  | 'snoozeDateInput'
  | 'snoozeSelected'
  | 'snoozeSelectedUntilDate'
  | 'startContainer'
  | 'triggerError'
  | 'triggerMessage'
  | 'triggerRunInProgress'
  | 'triggersLoading'
  | 'unsnoozeSelected'
  | 'updateAllInGroup'
  | 'updateContainer'
  | 'updateOperationsError'
  | 'updateOperationsLoading'
  | 'clearSkipsSelected'
  | 'clearPolicySelected'
>;

interface ContainersViewDisplayContainer extends Container {
  _pending?: true;
}

interface ContainersViewRenderGroup {
  key: string;
  name: string | null;
  containers: ContainersViewDisplayContainer[];
  containerCount: number;
  updatesAvailable: number;
  updatableCount: number;
}

interface ContainersViewTableColumn {
  key: string;
  label: string;
  align?: string;
  sortable: boolean;
  width?: string;
  icon: boolean;
}

export interface ContainersViewTemplateContext
  extends ContainerFiltersContext,
    ColumnVisibilityContext,
    DetailPanelContext,
    ContainerLogsContext,
    ContainerSecurityContext,
    ContainerActionsContext {
  error: Ref<string | null>;
  loading: Ref<boolean>;
  containers: Ref<Container[]>;
  containerViewMode: ReturnType<typeof useViewMode>;
  serverNames: ComputedRef<string[]>;
  toggleColumnPicker: (event: MouseEvent) => void;
  columnPickerStyle: Ref<Record<string, string>>;
  tt: (label: string) => { value: string; showDelay: number };
  groupByStack: WritableComputedRef<boolean>;
  rechecking: Ref<boolean>;
  recheckAll: () => Promise<void>;
  renderGroups: ComputedRef<ContainersViewRenderGroup[]>;
  toggleGroupCollapse: (key: string) => void;
  collapsedGroups: Ref<Set<string>>;
  tableColumns: ComputedRef<ContainersViewTableColumn[]>;
  containerSortKey: WritableComputedRef<string>;
  containerSortAsc: WritableComputedRef<boolean>;
  isCompact: ComputedRef<boolean>;
  tableActionStyle: WritableComputedRef<PreferencesSchema['containers']['tableActions']>;
  openActionsMenu: Ref<string | null>;
  toggleActionsMenu: (name: string, event: MouseEvent) => void;
  closeActionsMenu: () => void;
  displayContainers: ComputedRef<ContainersViewDisplayContainer[]>;
  actionsMenuStyle: Ref<Record<string, string>>;
  updateKindColor: typeof updateKindColor;
  hasRegistryError: (container: Container) => boolean;
  registryErrorTooltip: (container: Container) => string;
  serverBadgeColor: typeof serverBadgeColor;
  parseServer: typeof parseServer;
  registryColorBg: typeof registryColorBg;
  registryColorText: typeof registryColorText;
  registryLabel: typeof registryLabel;
  isMobile: ReturnType<typeof useBreakpoints>['isMobile'];
  LOG_AUTO_FETCH_INTERVALS: ReadonlyArray<LogAutoFetchIntervalOption>;
}

export const containersViewTemplateContextKey: InjectionKey<ContainersViewTemplateContext> = Symbol(
  'containers-view-template-context',
);

export function useContainersViewTemplateContext(): ContainersViewTemplateContext {
  const context = inject(containersViewTemplateContextKey);
  if (!context) {
    throw new Error('ContainersView template context is not available');
  }
  return context;
}
