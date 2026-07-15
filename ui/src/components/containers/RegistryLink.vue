<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Container } from '../../types/container';
import AppIconButton from '../AppIconButton.vue';
import type { IconButtonSize } from '../appIconButtonSizes';
import { registryHref, registryLookup } from './registry-link';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    registry?: Container['registry'];
    registryName?: string;
    registryUrl?: string;
    iconSize?: IconButtonSize;
  }>(),
  { iconSize: 'sm' },
);

const lookup = computed(() =>
  registryLookup(props.registry, props.registryName, props.registryUrl),
);
const href = computed(() => (lookup.value ? registryHref(lookup.value) : ''));
</script>

<template>
  <AppIconButton
    v-if="href"
    icon="registries"
    :size="iconSize"
    variant="muted"
    :href="href"
    :tooltip="t('containerComponents.registryLink.viewRegistry')"
    :aria-label="t('containerComponents.registryLink.viewRegistry')"
    data-test="registry-link"
    @click.stop
  />
</template>
