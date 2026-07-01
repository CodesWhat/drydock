import type { ComputedRef, Ref } from 'vue';
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
void filterSearch;
void renderGroups;
void tableColumns;
void detailTabs;
void updateContainer;
void hasRegistryError;
void unknownKey;
