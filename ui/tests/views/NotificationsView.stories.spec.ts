import { DefaultTable } from '@/views/NotificationsView.stories';

interface NotificationRuleLike {
  id: string;
  triggers: string[];
}

async function installStoryMock(): Promise<void> {
  const loader = DefaultTable.loaders?.[0];
  if (!loader) {
    throw new Error('DefaultTable story loader is not defined');
  }
  await loader();
}

describe('NotificationsView story mock', () => {
  it('supports PATCH requests passed as Request objects', async () => {
    await installStoryMock();

    const patchRequest = new Request('http://localhost/api/v1/notifications/update-available', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        triggers: ['trig-http', 'trig-http'],
      }),
    });

    const patchResponse = await fetch(patchRequest);
    expect(patchResponse.status).toBe(200);

    const rulesResponse = await fetch('/api/v1/notifications');
    const rules = (await rulesResponse.json()) as NotificationRuleLike[];
    const updatedRule = rules.find((rule) => rule.id === 'update-available');
    expect(updatedRule?.triggers).toEqual(['trig-http']);
  });
});
