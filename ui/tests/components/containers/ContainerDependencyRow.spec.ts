import ContainerDependencyRow from '@/components/containers/ContainerDependencyRow.vue';
import type { DependencyGraph, DependencyGraphNode } from '@/types/container';
import { buildDependencyAdjacency } from '@/utils/dependency-graph-view';
import { mountWithPlugins } from '../../helpers/mount';

function makeNode(id: string, displayName?: string): DependencyGraphNode {
  return { id, name: id, displayName: displayName ?? id };
}

function makeGraph(overrides: Partial<DependencyGraph> = {}): DependencyGraph {
  return {
    nodes: overrides.nodes ?? [],
    edges: overrides.edges ?? [],
    cycles: overrides.cycles ?? [],
    unresolved: overrides.unresolved ?? [],
    crossHostIgnored: overrides.crossHostIgnored ?? [],
  };
}

function mountRow(overrides: Partial<InstanceType<typeof ContainerDependencyRow>['$props']> = {}) {
  const graph = makeGraph({
    nodes: [makeNode('web'), makeNode('db', 'Database')],
    edges: [{ from: 'web', to: 'db', action: 'update', source: 'label' }],
  });
  const adjacency = buildDependencyAdjacency(graph);

  return mountWithPlugins(ContainerDependencyRow, {
    props: {
      container: { id: 'web', name: 'web' },
      adjacency,
      cycle: false,
      groupSize: 1,
      containerActionsEnabled: true,
      ...overrides,
    },
  });
}

describe('ContainerDependencyRow', () => {
  it('renders the depends-on list resolved from the adjacency', () => {
    const wrapper = mountRow();

    const parents = wrapper.find('[data-test="container-dependency-parents"]');
    expect(parents.exists()).toBe(true);
    expect(parents.text()).toContain('Depends on');
    expect(parents.text()).toContain('Database');
  });

  it('renders the required-by list for a parent container', () => {
    const graph = makeGraph({
      nodes: [makeNode('web'), makeNode('db', 'Database')],
      edges: [{ from: 'web', to: 'db', action: 'update', source: 'label' }],
    });
    const adjacency = buildDependencyAdjacency(graph);
    const wrapper = mountRow({ container: { id: 'db', name: 'db' }, adjacency });

    const children = wrapper.find('[data-test="container-dependency-children"]');
    expect(children.exists()).toBe(true);
    expect(children.text()).toContain('Required by');
    expect(children.text()).toContain('web');
  });

  it('falls back to the node name when displayName is empty', () => {
    const graph = makeGraph({
      nodes: [makeNode('web'), { id: 'db', name: 'db', displayName: '' }],
      edges: [{ from: 'web', to: 'db', action: 'update', source: 'label' }],
    });
    const adjacency = buildDependencyAdjacency(graph);
    const wrapper = mountRow({ adjacency });

    expect(wrapper.find('[data-test="container-dependency-parents"]').text()).toContain('db');
  });

  it('does not render a parents or children list when there are none', () => {
    const adjacency = buildDependencyAdjacency(makeGraph());
    const wrapper = mountRow({ container: { id: 'lonely', name: 'lonely' }, adjacency });

    expect(wrapper.find('[data-test="container-dependency-parents"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="container-dependency-children"]').exists()).toBe(false);
  });

  it('shows a cycle chip when the cycle prop is true', () => {
    const wrapper = mountRow({ cycle: true });

    const chip = wrapper.find('[data-test="container-dependency-cycle"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain('Part of a dependency cycle');
  });

  it('hides the cycle chip when the cycle prop is false', () => {
    const wrapper = mountRow({ cycle: false });

    expect(wrapper.find('[data-test="container-dependency-cycle"]').exists()).toBe(false);
  });

  it('shows the update-group button when the group has 2+ members and actions are enabled', () => {
    const wrapper = mountRow({ groupSize: 2, containerActionsEnabled: true });

    const button = wrapper.find('[data-test="container-dependency-update-group"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain('Update dependency group (2)');
  });

  it('hides the update-group button when the group has fewer than 2 members', () => {
    const wrapper = mountRow({ groupSize: 1, containerActionsEnabled: true });

    expect(wrapper.find('[data-test="container-dependency-update-group"]').exists()).toBe(false);
  });

  it('hides the update-group button when container actions are disabled', () => {
    const wrapper = mountRow({ groupSize: 3, containerActionsEnabled: false });

    expect(wrapper.find('[data-test="container-dependency-update-group"]').exists()).toBe(false);
  });

  it('emits update-group with the container when the button is clicked', async () => {
    const wrapper = mountRow({ groupSize: 2, containerActionsEnabled: true });

    await wrapper.find('[data-test="container-dependency-update-group"]').trigger('click');

    expect(wrapper.emitted('update-group')).toBeTruthy();
    expect(wrapper.emitted('update-group')?.[0]).toEqual([{ id: 'web', name: 'web' }]);
  });
});
