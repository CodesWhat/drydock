import { nextTick, ref } from 'vue';
import type { Container } from '@/types/container';

function container(id: string, overrides: Partial<Container> = {}): Container {
  return {
    id,
    identityKey: id,
    name: id,
    image: 'nginx',
    icon: '',
    currentTag: 'latest',
    newTag: null,
    isDigestPinned: false,
    status: 'running',
    registry: 'custom',
    updateKind: null,
    bouncer: 'safe',
    server: 'Local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

async function setup() {
  const { useContainerFilters } = await import('@/composables/useContainerFilters');
  const rows = ref([
    container('local', {
      registryName: 'quay',
      registryUrl: 'https://quay.io',
      tagPrecision: 'floating',
      labels: { team: '', expression: 'a=b' },
    }),
    container('remote', {
      agent: 'Local',
      registryName: 'quay',
      registryUrl: 'https://private.example',
      tagPrecision: 'specific',
      newTag: '1.2.4',
      updateKind: 'patch',
      labels: { team: 'ops', expression: 'a=b' },
    }),
    container('edge', {
      agent: 'edge',
      status: 'stopped',
      isDigestPinned: true,
      labels: { team: 'ops', zero: 0, disabled: false },
    }),
    container('unknown'),
  ]);
  const filters = useContainerFilters(rows);
  expect(filters.fleet).toBeDefined();
  return { rows, filters, fleet: filters.fleet };
}

describe('fleet dimensions', () => {
  it('keeps an agent named Local visibly distinct from local watchers', async () => {
    const { fleet } = await setup();
    const { default: english } = await import('@/locales/en/containerComponents.json');
    const messages = english.containerComponents.fleetDimensions as Record<string, string>;
    const translate = (key: string) => messages[key.split('.').at(-1)!];
    const labels = fleet.agentOptions.value.map((option) => fleet.optionLabel(option, translate));
    expect(labels).toContain('Local watchers');
    expect(labels).toContain('Local');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('sorts equal group labels by their distinct keys regardless of incoming order', async () => {
    const { fleet } = await setup();
    fleet.groupBy.value = 'label';
    fleet.groupLabel.value = 'number';
    const rows = [
      container('numeric', { labels: { number: 0 } }),
      container('text', { labels: { number: '0' } }),
    ];
    const groupIds = (input: Container[]) =>
      fleet.group(input, (key) => key).map((group) => group.key);
    expect(groupIds(rows)).toEqual(groupIds([...rows].reverse()));
    expect(new Set(groupIds(rows)).size).toBe(2);
  });

  it('offers stable distinct dimensions and preserves unknown and unversioned tags', async () => {
    const { rows, fleet, filters } = await setup();
    rows.value.push(
      container('version', { imageTagSemver: true }),
      container('missing', { currentTag: '' }),
    );
    expect(fleet.agentOptions.value).toHaveLength(3);
    expect(fleet.registryOptions.value).toHaveLength(3);
    expect(fleet.labelKeys.value).toEqual(['disabled', 'expression', 'team', 'zero']);
    fleet.tagType.value = 'semver';
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual(['version']);
    fleet.tagType.value = 'unknown';
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual(['missing']);
    fleet.tagType.value = 'tag';
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual(['unknown']);
    fleet.tagType.value = 'floating';
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual(['local']);
    fleet.tagType.value = 'digest';
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual(['edge']);
  });

  it('groups every dimension without flattening singleton groups and localizes their labels', async () => {
    const { rows, fleet } = await setup();
    const translate = (key: string) => `translated:${key}`;
    expect(fleet.group(rows.value, translate)).toEqual([]);
    for (const [by, count] of [
      ['agent', 3],
      ['registry', 3],
      ['status', 2],
      ['tagType', 4],
    ] as const) {
      fleet.groupBy.value = by;
      const groups = fleet.group(rows.value, translate);
      expect(groups).toHaveLength(count);
      expect(groups.reduce((sum, group) => sum + group.containerCount, 0)).toBe(4);
    }
    const local = fleet.agentOptions.value.find((option) => option.labelKey === 'local')!;
    expect(fleet.optionLabel(local, translate)).toContain('translated:');
    expect(fleet.optionLabel({ value: 'edge', label: 'edge' }, translate)).toBe('edge');
    rows.value[1].updateEligibility = {
      eligible: false,
      evaluatedAt: '',
      blockers: [
        { reason: 'rollback-container', severity: 'hard', message: 'blocked', actionable: false },
      ],
    };
    fleet.groupBy.value = 'agent';
    expect(
      fleet.group(rows.value, translate).find((group) => group.containers[0].id === 'remote')
        ?.updatableCount,
    ).toBe(0);
  });

  it('uses own label keys and preserves false, zero, null and equals characters', async () => {
    const { rows, filters, fleet } = await setup();
    rows.value = [
      container('false', { labels: { setting: false } }),
      container('zero', { labels: { setting: 0 } }),
      container('null', { labels: { setting: null } }),
      container('equals', { labels: { setting: 'a=b' } }),
      container('inherited', { labels: Object.create({ setting: 'a=b' }) }),
    ];
    fleet.labelKey.value = 'setting';
    fleet.labelMatch.value = 'equals';
    for (const value of ['false', '0', 'null', 'a=b']) {
      fleet.labelValue.value = value;
      expect(filters.filteredContainers.value).toHaveLength(1);
    }
    expect(filters.filteredContainers.value[0].id).toBe('equals');
    fleet.groupBy.value = 'label';
    fleet.groupLabel.value = 'setting';
    expect(fleet.group(rows.value, (key) => key)).toHaveLength(5);
  });

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('separates local ownership from an agent with the same display name', async () => {
    const { filters, fleet } = await setup();
    fleet.agent.value = JSON.stringify(['agent', 'Local']);
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual(['remote']);
    fleet.agent.value = JSON.stringify(['local']);
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual(['local', 'unknown']);
  });

  it('separates real registries within the custom display category', async () => {
    const { filters, fleet } = await setup();
    fleet.registry.value = JSON.stringify(['quay', 'https://private.example']);
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual(['remote']);
  });

  it('combines tag shape, label predicates and existing update/status filters', async () => {
    const { filters, fleet } = await setup();
    fleet.tagType.value = 'specific';
    fleet.labelKey.value = 'expression';
    fleet.labelValue.value = 'a=b';
    fleet.labelMatch.value = 'equals';
    filters.filterKind.value = 'patch';
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual(['remote']);
    filters.filterStatus.value = 'stopped';
    expect(filters.filteredContainers.value).toEqual([]);
  });

  it('distinguishes absent labels from empty values without reparsing display strings', async () => {
    const { filters, fleet } = await setup();
    fleet.labelKey.value = 'team';
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual([
      'local',
      'remote',
      'edge',
    ]);
    fleet.labelMatch.value = 'equals';
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual(['local']);
    fleet.labelMatch.value = 'missing';
    expect(filters.filteredContainers.value.map((row) => row.id)).toEqual(['unknown']);
  });

  it('persists filters and grouping while clear resets filters but not grouping', async () => {
    const { filters, fleet } = await setup();
    fleet.agent.value = JSON.stringify(['agent', 'edge']);
    fleet.registry.value = 'registry';
    fleet.tagType.value = 'digest';
    fleet.labelKey.value = 'team';
    fleet.groupBy.value = 'agent';
    expect(filters.activeFilterCount.value).toBe(4);
    await nextTick();
    const { preferences } = await import('@/preferences/store');
    expect(preferences.containers.fleet.agent).toBe(fleet.agent.value);
    expect(preferences.containers.fleet.groupBy).toBe('agent');
    filters.clearFilters();
    expect(filters.activeFilterCount.value).toBe(0);
    expect(fleet.groupBy.value).toBe('agent');
    expect(filters.filteredContainers.value).toHaveLength(4);
  });

  it('groups sorted rows without changing their identity and counts only eligible updates', async () => {
    const { rows, fleet } = await setup();
    fleet.groupBy.value = 'label';
    fleet.groupLabel.value = 'team';
    const groups = fleet.group(rows.value, (key: string) => key);
    expect(groups.map((group) => group.containerCount).sort()).toEqual([1, 1, 2]);
    const ops = groups.find((group) => group.name === 'ops');
    expect(ops?.containers.map((row) => row.id)).toEqual(['remote', 'edge']);
    expect(ops?.containers[0]).toBe(rows.value[1]);
    expect(ops?.updatesAvailable).toBe(1);
    expect(ops?.updatableCount).toBe(1);
    expect(groups.find((group) => group.containers[0].id === 'unknown')?.key).not.toBe(
      groups.find((group) => group.containers[0].id === 'local')?.key,
    );
  });
});
