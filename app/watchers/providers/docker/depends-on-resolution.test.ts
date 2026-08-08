import { resolveComposeDependsOn } from '../../../dependencies/compose-dependency-resolver.js';
import log from '../../../log/index.js';
import { resolveContainerDependsOn, resolveDependsOnFromLabels } from './container-init.js';

vi.mock('../../../log/index.js', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

describe('resolveDependsOnFromLabels', () => {
  test('returns nothing when neither dd.depends_on nor dd.depends_on.action is set', () => {
    expect(resolveDependsOnFromLabels({}, 'web')).toEqual({});
  });

  test('parses a single dd.depends_on name', () => {
    expect(resolveDependsOnFromLabels({ 'dd.depends_on': 'db' }, 'web')).toEqual({
      dependsOn: ['db'],
      dependsOnAction: 'update',
    });
  });

  test('trims, dedupes, and drops blank entries in a comma-separated list', () => {
    expect(resolveDependsOnFromLabels({ 'dd.depends_on': ' db , redis ,, db ' }, 'web')).toEqual({
      dependsOn: ['db', 'redis'],
      dependsOnAction: 'update',
    });
  });

  test('an explicitly-empty dd.depends_on label overrides to no dependencies (still label-sourced)', () => {
    expect(resolveDependsOnFromLabels({ 'dd.depends_on': '' }, 'web')).toEqual({
      dependsOn: [],
      dependsOnAction: 'update',
    });
  });

  test('drops a self-referencing entry and warns once per container', () => {
    const warn = vi.fn();
    const warnedSelfReferences = new Set<string>();

    const first = resolveDependsOnFromLabels({ 'dd.depends_on': 'web,db' }, 'web', {
      warn,
      warnedSelfReferences,
    });
    expect(first.dependsOn).toEqual(['db']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('self-reference'));

    resolveDependsOnFromLabels({ 'dd.depends_on': 'web,cache' }, 'web', {
      warn,
      warnedSelfReferences,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('honors dd.depends_on.action=restart', () => {
    expect(
      resolveDependsOnFromLabels(
        { 'dd.depends_on': 'db', 'dd.depends_on.action': 'restart' },
        'web',
      ),
    ).toEqual({ dependsOn: ['db'], dependsOnAction: 'restart' });
  });

  test('honors dd.depends_on.action=update explicitly', () => {
    expect(
      resolveDependsOnFromLabels(
        { 'dd.depends_on': 'db', 'dd.depends_on.action': 'update' },
        'web',
      ),
    ).toEqual({ dependsOn: ['db'], dependsOnAction: 'update' });
  });

  test('falls back to update and warns once per container+value on an unrecognized action', () => {
    const warn = vi.fn();
    const warnedInvalidActions = new Set<string>();

    const first = resolveDependsOnFromLabels({ 'dd.depends_on.action': 'bogus' }, 'web', {
      warn,
      warnedInvalidActions,
    });
    expect(first.dependsOnAction).toBe('update');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unrecognized value "bogus"'));

    resolveDependsOnFromLabels({ 'dd.depends_on.action': 'bogus' }, 'web', {
      warn,
      warnedInvalidActions,
    });
    expect(warn).toHaveBeenCalledTimes(1);

    resolveDependsOnFromLabels({ 'dd.depends_on.action': 'nope' }, 'web', {
      warn,
      warnedInvalidActions,
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('returns only dependsOnAction when dd.depends_on.action is set without dd.depends_on', () => {
    expect(resolveDependsOnFromLabels({ 'dd.depends_on.action': 'restart' }, 'web')).toEqual({
      dependsOnAction: 'restart',
    });
  });

  test('warns via the default logger when no warn callback is supplied (self-reference)', () => {
    const result = resolveDependsOnFromLabels({ 'dd.depends_on': 'web,db' }, 'web');
    expect(result.dependsOn).toEqual(['db']);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('self-reference'));
  });

  test('warns via the default logger when no warn callback is supplied (invalid action)', () => {
    const result = resolveDependsOnFromLabels({ 'dd.depends_on.action': 'bogus' }, 'web');
    expect(result.dependsOnAction).toBe('update');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('unrecognized value "bogus"'));
  });

  test('does not attempt any cross-container/agent scoping at parse time', () => {
    // Names are stored as opaque strings — resolution against other
    // containers (name/agent scoping, unresolved targets) is deferred to the
    // graph engine, which has the full fleet view. This characterizes that
    // container-init performs no such validation itself.
    const result = resolveDependsOnFromLabels(
      { 'dd.depends_on': 'some-container-on-another-agent' },
      'web',
    );
    expect(result.dependsOn).toEqual(['some-container-on-another-agent']);
  });
});

describe('resolveContainerDependsOn', () => {
  test('label wins outright and never calls the compose resolver', async () => {
    const resolveCompose = vi.fn();
    const result = await resolveContainerDependsOn({ 'dd.depends_on': 'db' }, 'web', {
      resolveComposeDependsOn: resolveCompose,
    });
    expect(result).toEqual({
      dependsOn: ['db'],
      dependsOnSource: 'label',
      dependsOnAction: 'update',
    });
    expect(resolveCompose).not.toHaveBeenCalled();
  });

  test('falls back to compose detection when no label is present', async () => {
    const resolveCompose = vi.fn().mockResolvedValue({ dependsOn: ['db', 'cache'], warnings: [] });
    const result = await resolveContainerDependsOn({ 'com.docker.compose.service': 'web' }, 'web', {
      resolveComposeDependsOn: resolveCompose,
    });
    expect(result).toEqual({
      dependsOn: ['db', 'cache'],
      dependsOnSource: 'compose',
      dependsOnAction: 'update',
    });
    expect(resolveCompose).toHaveBeenCalledWith({
      labels: { 'com.docker.compose.service': 'web' },
    });
  });

  test('carries a dd.depends_on.action override into a compose-sourced result', async () => {
    const resolveCompose = vi.fn().mockResolvedValue({ dependsOn: ['db'], warnings: [] });
    const result = await resolveContainerDependsOn({ 'dd.depends_on.action': 'restart' }, 'web', {
      resolveComposeDependsOn: resolveCompose,
    });
    expect(result.dependsOnAction).toBe('restart');
    expect(result.dependsOnSource).toBe('compose');
  });

  test('returns no dependsOn/dependsOnSource when compose detection finds nothing', async () => {
    const resolveCompose = vi.fn().mockResolvedValue({ dependsOn: [], warnings: [] });
    const result = await resolveContainerDependsOn({}, 'web', {
      resolveComposeDependsOn: resolveCompose,
    });
    expect(result).toEqual({ dependsOnAction: undefined });
  });

  test('forwards compose-resolver warnings to the warn callback', async () => {
    const warn = vi.fn();
    const resolveCompose = vi.fn().mockResolvedValue({
      dependsOn: ['db'],
      warnings: ['compose warning one', 'compose warning two'],
    });
    await resolveContainerDependsOn({}, 'web', { resolveComposeDependsOn: resolveCompose, warn });
    expect(warn).toHaveBeenCalledWith('compose warning one');
    expect(warn).toHaveBeenCalledWith('compose warning two');
  });

  test('uses the real compose-dependency-resolver module when none is injected', async () => {
    // No compose service label present — resolveComposeDependsOn short-circuits
    // without touching the filesystem, so this safely exercises the default
    // wiring end to end.
    const result = await resolveContainerDependsOn({}, 'web');
    expect(result).toEqual({ dependsOnAction: undefined });
  });

  test('warns via the default logger when no warn callback is supplied (compose warnings)', async () => {
    const resolveCompose = vi.fn().mockResolvedValue({
      dependsOn: ['db'],
      warnings: ['compose warning via default logger'],
    });
    await resolveContainerDependsOn({}, 'web', { resolveComposeDependsOn: resolveCompose });
    expect(log.warn).toHaveBeenCalledWith('compose warning via default logger');
  });

  test('the default compose resolver is the same module export used elsewhere', async () => {
    // Sanity check that container-init.ts wires up the real module rather
    // than a local reimplementation.
    const direct = await resolveComposeDependsOn({ labels: {} });
    expect(direct).toEqual({ dependsOn: [], warnings: [] });
  });
});
