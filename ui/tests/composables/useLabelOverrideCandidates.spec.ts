import { useLabelOverrideCandidates } from '@/composables/useLabelOverrideCandidates';
import { getAllContainers } from '@/services/container';
import { getAllTriggers } from '@/services/trigger';

vi.mock('@/services/container', () => ({ getAllContainers: vi.fn() }));
vi.mock('@/services/trigger', () => ({ getAllTriggers: vi.fn() }));

const trigger = (id: string, type: string) => ({ id, type, name: id, configuration: {} });
const scope = { agent: null, watcher: 'local', appliesTo: [{ id: 'c1', name: 'web' }] };

beforeEach(() => {
  vi.mocked(getAllTriggers).mockReset().mockResolvedValue([]);
  vi.mocked(getAllContainers).mockReset().mockResolvedValue([]);
});

describe('useLabelOverrideCandidates', () => {
  it('starts unknown, then splits triggers into action and notification ids', async () => {
    vi.mocked(getAllTriggers).mockResolvedValue([
      trigger('slack.team', 'slack'),
      trigger('docker.local', 'docker'),
      trigger('dockercompose.stack', 'dockercompose'),
      trigger('slack.team', 'slack'),
      trigger('command.run', 'command'),
    ]);
    const candidates = useLabelOverrideCandidates();
    expect(candidates.triggers.value).toBeNull();
    await candidates.load();
    expect(candidates.triggers.value).toEqual({
      action: ['command.run', 'docker.local', 'dockercompose.stack'],
      notification: ['slack.team'],
    });
  });

  it('offers containers on the same watcher and agent, minus the scope', async () => {
    vi.mocked(getAllContainers).mockResolvedValue([
      { name: 'web', watcher: 'local' },
      { name: 'db', watcher: 'local' },
      { name: 'db', watcher: 'local' },
      { name: 'cache', watcher: 'local', agent: '' },
      { name: 'other', watcher: 'remote' },
      { name: 'nas-db', watcher: 'local', agent: 'nas' },
      { name: 42, watcher: 'local' },
      { name: 'odd', watcher: 7, agent: 7 },
    ]);
    const candidates = useLabelOverrideCandidates();
    await candidates.load();
    expect(candidates.containerNames(scope)).toEqual(['cache', 'db']);
    expect(candidates.containerNames({ ...scope, agent: 'nas' })).toEqual(['nas-db']);
  });

  it('keeps each list unknown when its request fails', async () => {
    vi.mocked(getAllTriggers).mockRejectedValue(new Error('down'));
    vi.mocked(getAllContainers).mockRejectedValue(new Error('down'));
    const candidates = useLabelOverrideCandidates();
    await candidates.load();
    expect(candidates.triggers.value).toBeNull();
    expect(candidates.containerNames(scope)).toEqual([]);
  });

  it('drops the result of a load that a newer load replaced', async () => {
    let release!: (value: ReturnType<typeof trigger>[]) => void;
    vi.mocked(getAllTriggers).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const candidates = useLabelOverrideCandidates();
    const first = candidates.load();
    vi.mocked(getAllTriggers).mockResolvedValueOnce([trigger('docker.new', 'docker')]);
    await candidates.load();
    release([trigger('docker.old', 'docker')]);
    await first;
    expect(candidates.triggers.value?.action).toEqual(['docker.new']);
  });
});
