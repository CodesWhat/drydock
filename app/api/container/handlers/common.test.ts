import type { Container } from '../../../model/container.js';
import { resolveWatcherIdForContainer } from './common.js';

describe('resolveWatcherIdForContainer', () => {
  test('resolves a local Docker container to its docker watcher', () => {
    expect(resolveWatcherIdForContainer({ id: 'abc123', watcher: 'local' } as Container)).toBe(
      'docker.local',
    );
  });

  test('prefixes the agent for a container owned by a remote agent', () => {
    expect(
      resolveWatcherIdForContainer({ id: 'abc123', watcher: 'edge', agent: 'node-1' } as Container),
    ).toBe('node-1.docker.edge');
  });

  test('resolves a file-sourced container to its file watcher', () => {
    expect(
      resolveWatcherIdForContainer({
        id: 'file-0123456789abcdef01234567',
        watcher: 'staging',
      } as Container),
    ).toBe('file.staging');
  });
});
