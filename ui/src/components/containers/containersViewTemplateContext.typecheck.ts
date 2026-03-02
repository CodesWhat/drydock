import type { Ref } from 'vue';
import type { ContainersViewTemplateContext } from './containersViewTemplateContext';

declare const context: ContainersViewTemplateContext;

const filterSearch: Ref<string> = context.filterSearch;
const detailTabs: Array<{ id: string; label: string; icon: string }> = context.detailTabs;
const updateContainer: (containerName: string) => Promise<void> = context.updateContainer;
// @ts-expect-error unknown context keys should not be accepted
const unknownKey = context.thisKeyShouldNotExist;

void filterSearch;
void detailTabs;
void updateContainer;
void unknownKey;
