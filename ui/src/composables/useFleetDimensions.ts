import { computed, type Ref } from 'vue';
import type { FleetGroupDimension, FleetPreferences } from '../preferences/schema';
import { DEFAULTS } from '../preferences/schema';
import { preferences } from '../preferences/store';
import { usePreference } from '../preferences/usePreference';
import type { Container } from '../types/container';
import { hasHardBlocker } from '../utils/update-eligibility';

interface DimensionOption {
  value: string;
  label: string;
  labelKey?: string;
}

type Translate = (key: string) => string;

function tagType(container: Container): string {
  if (container.isDigestPinned) return 'digest';
  if (container.tagPrecision) return container.tagPrecision;
  if (container.imageTagSemver) return 'semver';
  return container.currentTag ? 'tag' : 'unknown';
}

function dimension(
  container: Container,
  by: Exclude<FleetGroupDimension, 'none'>,
  labelKey: string,
): DimensionOption {
  switch (by) {
    case 'agent':
      return container.agent
        ? { value: JSON.stringify(['agent', container.agent]), label: container.agent }
        : { value: JSON.stringify(['local']), label: '', labelKey: 'local' };
    case 'registry':
      return {
        value: JSON.stringify([container.registryName ?? '', container.registryUrl ?? '']),
        label: [container.registryName, container.registryUrl].filter(Boolean).join(' · '),
        ...(!container.registryName && !container.registryUrl ? { labelKey: 'unknown' } : {}),
      };
    case 'status':
      return { value: container.status, label: '', labelKey: container.status };
    case 'tagType': {
      const value = tagType(container);
      return { value, label: '', labelKey: value };
    }
    case 'label': {
      if (!Object.hasOwn(container.labels ?? {}, labelKey)) {
        return { value: JSON.stringify(['missing']), label: '', labelKey: 'missingLabel' };
      }
      const value = container.labels?.[labelKey];
      return {
        value: JSON.stringify(['value', value]),
        label: String(value),
        ...(value === '' ? { labelKey: 'emptyValue' } : {}),
      };
    }
  }
}

function optionLabel(option: DimensionOption, t: Translate): string {
  return option.labelKey
    ? t(`containerComponents.fleetDimensions.${option.labelKey}`)
    : option.label;
}

export function useFleetDimensions(containers: Ref<Container[]>) {
  function preference<K extends keyof FleetPreferences>(key: K) {
    return usePreference(
      () => preferences.containers.fleet[key],
      (value) => {
        preferences.containers.fleet[key] = value;
      },
    );
  }
  const agent = preference('agent');
  const registry = preference('registry');
  const selectedTagType = preference('tagType');
  const labelKey = preference('labelKey');
  const labelValue = preference('labelValue');
  const labelMatch = preference('labelMatch');
  const groupBy = preference('groupBy');
  const groupLabel = preference('groupLabel');

  function options(by: 'agent' | 'registry') {
    return computed(() =>
      [
        ...new Map(
          containers.value.map((container) => {
            const option = dimension(container, by, '');
            return [option.value, option] as const;
          }),
        ).values(),
      ].sort((a, b) => a.label.localeCompare(b.label)),
    );
  }
  const agentOptions = options('agent');
  const registryOptions = options('registry');
  const labelKeys = computed(() =>
    [
      ...new Set(containers.value.flatMap((container) => Object.keys(container.labels ?? {}))),
    ].sort(),
  );
  const activeFilterCount = computed(
    () =>
      [
        agent.value !== 'all',
        registry.value !== 'all',
        selectedTagType.value !== 'all',
        labelKey.value !== '',
      ].filter(Boolean).length,
  );

  function matches(container: Container): boolean {
    if (agent.value !== 'all' && dimension(container, 'agent', '').value !== agent.value)
      return false;
    if (registry.value !== 'all' && dimension(container, 'registry', '').value !== registry.value)
      return false;
    if (selectedTagType.value !== 'all' && tagType(container) !== selectedTagType.value)
      return false;
    if (labelKey.value === '') return true;
    const present = Object.hasOwn(container.labels ?? {}, labelKey.value);
    if (labelMatch.value === 'missing') return !present;
    return (
      present &&
      (labelMatch.value === 'exists' ||
        String(container.labels?.[labelKey.value]) === labelValue.value)
    );
  }

  function clearFilters() {
    const defaults = DEFAULTS.containers.fleet;
    Object.assign(preferences.containers.fleet, {
      agent: defaults.agent,
      registry: defaults.registry,
      tagType: defaults.tagType,
      labelKey: defaults.labelKey,
      labelValue: defaults.labelValue,
      labelMatch: defaults.labelMatch,
    });
  }

  function group<T extends Container>(sorted: T[], t: Translate) {
    if (groupBy.value === 'none') return [];
    const buckets = new Map<string, { option: DimensionOption; containers: T[] }>();
    for (const container of sorted) {
      const option = dimension(container, groupBy.value, groupLabel.value);
      let bucket = buckets.get(option.value);
      if (!bucket) {
        bucket = { option, containers: [] };
        buckets.set(option.value, bucket);
      }
      bucket.containers.push(container);
    }
    return [...buckets.values()]
      .map((bucket) => ({
        key: JSON.stringify(['fleet', groupBy.value, groupLabel.value, bucket.option.value]),
        name: optionLabel(bucket.option, t),
        containers: bucket.containers,
        containerCount: bucket.containers.length,
        updatesAvailable: bucket.containers.filter((container) => container.newTag).length,
        updatableCount: bucket.containers.filter(
          (container) => container.newTag && !hasHardBlocker(container.updateEligibility),
        ).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  }

  return {
    agent,
    registry,
    tagType: selectedTagType,
    labelKey,
    labelValue,
    labelMatch,
    groupBy,
    groupLabel,
    agentOptions,
    registryOptions,
    labelKeys,
    activeFilterCount,
    matches,
    clearFilters,
    group,
    optionLabel,
  };
}
