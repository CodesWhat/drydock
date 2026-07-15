import type { ComputedRef, Ref, WritableComputedRef } from 'vue';
import type { ViewMode } from '../../preferences/schema';
import type { Container } from '../../types/container';
import type {
  ContainersViewRenderGroup,
  ContainersViewTableColumn,
  ContainersViewTemplateContext,
} from './containersViewTemplateContext';

declare const context: ContainersViewTemplateContext;

const errorRef: Ref<string | null> = context.error;
const loadingRef: Ref<boolean> = context.loading;
const containersRef: Ref<Container[]> = context.containers;
const viewMode: WritableComputedRef<ViewMode> = context.containerViewMode;
const cardReflowForced: Ref<boolean> = context.containerCardReflowForced;
const filterSearch: Ref<string> = context.filterSearch;
const renderGroups: ComputedRef<ContainersViewRenderGroup[]> = context.renderGroups;
const tableColumns: ComputedRef<ContainersViewTableColumn[]> = context.tableColumns;
const detailTabs: ComputedRef<{ id: string; label: string; icon: string }[]> = context.detailTabs;
const updateContainer: (containerName: string) => Promise<void> = context.updateContainer;
const hasRegistryError: (container: Container) => boolean = context.hasRegistryError;
// @ts-expect-error unknown context keys should not be accepted
const unknownKey = context.thisKeyShouldNotExist;

void errorRef;
void loadingRef;
void containersRef;
void viewMode;
void cardReflowForced;
void filterSearch;
void renderGroups;
void tableColumns;
void detailTabs;
void updateContainer;
void hasRegistryError;
void unknownKey;
