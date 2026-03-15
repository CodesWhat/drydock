import {
  sampleContainerRows,
  sampleServiceCards,
  sampleWatcherItems,
} from '@/components/stories/sampleData';

describe('sample story data', () => {
  it('exports representative records for service cards, watchers, and containers', () => {
    expect(sampleServiceCards).toHaveLength(3);
    expect(sampleServiceCards[0]).toMatchObject({
      id: 'gateway',
      status: 'healthy',
    });

    expect(sampleWatcherItems).toHaveLength(3);
    expect(sampleWatcherItems[2]).toMatchObject({
      id: 'edge-2',
      status: 'disconnected',
    });

    expect(sampleContainerRows).toHaveLength(3);
    expect(sampleContainerRows[1]).toMatchObject({
      id: 'web',
      status: 'running',
      updates: 2,
    });
  });
});
