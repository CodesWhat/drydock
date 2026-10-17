import type { ComputedRef, Ref, WritableComputedRef } from 'vue';
import type { ViewMode } from '../../preferences/schema';
import type { Container } from '../../types/container';
import type ContainerDependencyRow from './ContainerDependencyRow.vue';
import type {
  ContainersViewRenderGroup,
  ContainersViewTableColumn,
  ContainersViewTemplateContext,
} from './containersViewTemplateContext';

declare const context: ContainersViewTemplateContext;

const errorRef: Ref<string | null> = context.error;
const loadingRef: Ref<boolean> = context.loading;
const backupsLoadingRef: Ref<boolean> = context.backupsLoading;
const backupId: string = context.detailBackups.value[0].id;
const backupTimestamp: string = context.detailBackups.value[0].timestamp;
const containersRef: Ref<Container[]> = context.containers;
const viewMode: WritableComputedRef<ViewMode> = context.containerViewMode;
const cardReflowForced: Ref<boolean> = context.containerCardReflowForced;
const filterSearch: Ref<string> = context.filterSearch;
const renderGroups: ComputedRef<ContainersViewRenderGroup[]> = context.renderGroups;
const tableColumns: ComputedRef<ContainersViewTableColumn[]> = context.tableColumns;
const detailTabs: ComputedRef<{ id: string; label: string; icon: string }[]> = context.detailTabs;
const updateContainer: (containerName: string) => Promise<void> = context.updateContainer;
const hasRegistryError: (container: Container) => boolean = context.hasRegistryError;
declare const dependencyTarget: InstanceType<typeof ContainerDependencyRow>['$props']['container'];
context.confirmDependencyGroupUpdate(dependencyTarget);
// @ts-expect-error a dependency action must retain canonical identity
const incompleteDependencyTarget: Parameters<typeof context.confirmDependencyGroupUpdate>[0] = {
  id: 'id',
  name: 'same-name',
};
// @ts-expect-error action ownership cannot be inferred from a duplicate display name
context.isContainerUpdateInProgress({ id: 'id', name: 'same-name' });
// @ts-expect-error unknown context keys should not be accepted
const unknownKey = context.thisKeyShouldNotExist;

void errorRef;
void loadingRef;
void backupsLoadingRef;
void backupId;
void backupTimestamp;
void containersRef;
void viewMode;
void cardReflowForced;
void filterSearch;
void renderGroups;
void tableColumns;
void detailTabs;
void updateContainer;
void hasRegistryError;
void incompleteDependencyTarget;
void unknownKey;
