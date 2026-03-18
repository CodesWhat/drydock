import { DefaultTable } from '@/views/WatchersView.stories';

interface WatcherLike {
  id: string;
  name: string;
}

async function installStoryMock(): Promise<void> {
  const loader = DefaultTable.loaders?.[0];
  if (!loader) {
    throw new Error('DefaultTable story loader is not defined');
  }
  await loader();
}

describe('WatchersView story mock', () => {
  it('returns watcher fixtures for GET /api/v1/watchers', async () => {
    await installStoryMock();

    const response = await fetch('/api/v1/watchers');
    expect(response.status).toBe(200);

    const watchers = (await response.json()) as WatcherLike[];
    expect(watchers.map((watcher) => watcher.name)).toEqual(
      expect.arrayContaining(['Local Docker', 'Edge Cluster 1', 'Edge Cluster 2']),
    );
  });

  it('rejects non-GET requests for /api/watchers', async () => {
    await installStoryMock();

    const postResponse = await fetch(
      new Request('http://localhost/api/watchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(postResponse.status).toBe(404);
  });
});
