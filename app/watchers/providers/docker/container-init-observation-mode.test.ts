import type { Container, ContainerReport } from '../../../model/container.js';

const mockObservationMode = vi.hoisted(() => vi.fn());
const mockStoreInit = vi.hoisted(() => vi.fn());
const mockInitObservationOnly = vi.hoisted(() => vi.fn());
const mockDeregisterObservationOnly = vi.hoisted(() => vi.fn());
const mockGetState = vi.hoisted(() => vi.fn());

vi.mock('../../../runtime/observation-mode.js', () => ({
  isObservationMode: mockObservationMode,
}));
vi.mock('../../../store/index.js', () => ({ init: mockStoreInit }));
vi.mock('../../../registry/index.js', () => ({
  initObservationOnly: mockInitObservationOnly,
  deregisterObservationOnly: mockDeregisterObservationOnly,
  getState: mockGetState,
}));

import { runScanCommand } from '../../../cli/scan.js';
import { getSettledContainersToWatch } from './container-init.js';

const summary = {
  Id: 'a1b2c3d4e5f60000000000000000000000000000000000000000000000000',
  Names: ['/app'],
} as any;

function makeWatcher(discoverysettlems?: number) {
  return {
    configuration: { cron: '0 */6 * * *', discoverysettlems },
    pendingDiscoveries: new Map(),
    log: { debug: vi.fn() },
  };
}

describe('discovery settling in observation mode (#156)', () => {
  beforeEach(() => {
    mockObservationMode.mockReset();
  });

  test('daemon mode still holds a new container back for the default window', () => {
    mockObservationMode.mockReturnValue(false);
    const watcher = makeWatcher();
    expect(getSettledContainersToWatch([summary], [], watcher)).toEqual([]);
    expect(watcher.pendingDiscoveries.has(summary.Id)).toBe(true);
  });

  test('observation mode processes a new container in the first pass, ignoring the configured window', () => {
    mockObservationMode.mockReturnValue(true);
    const watcher = makeWatcher(60_000);
    expect(getSettledContainersToWatch([summary], [], watcher)).toEqual([summary]);
    expect(watcher.pendingDiscoveries.size).toBe(0);
  });

  test('a one-shot scan counts and reports a newly discovered container', async () => {
    mockObservationMode.mockReturnValue(true);
    const watcher = {
      ...makeWatcher(),
      name: 'local',
      watch: async (): Promise<ContainerReport[]> =>
        getSettledContainersToWatch([summary], [], watcher).map(() => ({
          changed: true,
          container: {
            id: summary.Id,
            name: 'app',
            status: 'running',
            watcher: 'local',
            image: { registry: { name: 'hub' }, name: 'library/nginx', tag: { value: '1.0.0' } },
            updateAvailable: true,
            updateKind: {
              kind: 'tag',
              semverDiff: 'minor',
              localValue: '1.0.0',
              remoteValue: '1.1.0',
            },
          } as unknown as Container,
        })),
    };
    mockGetState.mockReturnValue({ watcher: { local: watcher } });
    const out: string[] = [];

    const code = await runScanCommand([], {
      io: { out: (m) => out.push(m), err: () => undefined },
    });

    const document = JSON.parse(out[0]);
    expect(document.summary).toMatchObject({ scanned: 1, updates: 1 });
    expect(code).toBe(3);
  });
});
