import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { containers } from './data/containers';
import { handlers } from './handlers';

const server = setupServer(...handlers);

beforeAll(() => {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('http://localhost'),
  });
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => server.close());

const base = 'http://localhost';
const jsonHeaders = { 'Content-Type': 'application/json' };

async function getJson(path: string) {
  const response = await fetch(`${base}${path}`);
  expect(response.status, `GET ${path}`).toBe(200);
  expect(response.headers.get('content-type'), `GET ${path}`).toMatch(/application\/json/);
  return response.json();
}

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...jsonHeaders, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('approvals contract', () => {
  test('summary counts match the pending list', async () => {
    const summary = await getJson('/api/v1/approvals/summary');
    const list = await getJson('/api/v1/approvals?status=pending');
    expect(summary).toEqual({
      pending: expect.any(Number),
      deferred: expect.any(Number),
      decidedToday: expect.any(Number),
    });
    expect(summary.pending).toBe(list.total);
    expect(summary.pending).toBeGreaterThan(1);
  });

  test('list returns the paginated envelope and references demo containers', async () => {
    const list = await getJson('/api/v1/approvals?status=all');
    expect(list).toMatchObject({
      data: expect.any(Array),
      total: list.data.length,
      limit: expect.any(Number),
      offset: 0,
      hasMore: false,
    });
    const ids = new Set(containers.map((c) => c.id));
    for (const approval of list.data) {
      expect(ids.has(approval.containerId)).toBe(true);
      expect(approval).toMatchObject({
        id: expect.any(String),
        containerName: expect.any(String),
        fromRef: expect.any(String),
        toRef: expect.any(String),
        decision: expect.stringMatching(/^(pending|approved|rejected|deferred)$/),
        createdAtMs: expect.any(Number),
      });
    }
  });

  test('detail returns approval plus holdReasons and 404s unknown ids', async () => {
    const list = await getJson('/api/v1/approvals?status=pending');
    const detail = await getJson(`/api/v1/approvals/${list.data[0].id}`);
    expect(detail.approval.id).toBe(list.data[0].id);
    expect(detail.holdReasons).toEqual([]);
    expect((await fetch(`${base}/api/v1/approvals/nope`)).status).toBe(404);
  });

  test('decisions validate bodies and update in-memory state', async () => {
    const list = await getJson('/api/v1/approvals?status=pending');
    const [first, second, third] = list.data;
    const before = await getJson('/api/v1/approvals/summary');

    for (const body of ['null', '[]', '{']) {
      expect((await postJson(`/api/v1/approvals/${first.id}/reject`, body)).status).toBe(400);
    }
    expect((await postJson('/api/v1/approvals/nope/reject', {})).status).toBe(404);

    const rejected = await (
      await postJson(`/api/v1/approvals/${first.id}/reject`, { note: 'not now' })
    ).json();
    expect(rejected.approval).toMatchObject({ id: first.id, decision: 'rejected' });

    const deferred = await (
      await postJson(`/api/v1/approvals/${second.id}/defer`, { days: 3 })
    ).json();
    expect(deferred.approval).toMatchObject({ id: second.id, decision: 'deferred' });
    expect(deferred.approval.deferredUntil).toEqual(expect.any(String));

    const approved = await (await postJson(`/api/v1/approvals/${third.id}/approve`, {})).json();
    expect(approved).toEqual({ operationId: expect.any(String), message: expect.any(String) });

    const summary = await getJson('/api/v1/approvals/summary');
    expect(summary.pending).toBe(list.total - 3);
    expect(summary.deferred).toBe(before.deferred + 1);
    expect(summary.decidedToday).toBe(before.decidedToday + 3);
  });

  test('bulk requires confirmation, a valid action and returns accepted/rejected lists', async () => {
    const confirm = { 'X-DD-Confirm-Action': 'approvals-bulk-approve' };
    expect(
      (await postJson('/api/v1/approvals/bulk', { ids: ['x'], action: 'approve' })).status,
    ).toBe(428);
    expect((await postJson('/api/v1/approvals/bulk', '{', confirm)).status).toBe(400);
    expect(
      (await postJson('/api/v1/approvals/bulk', { ids: ['x'], action: 'nuke' }, confirm)).status,
    ).toBe(400);
    const result = await (
      await postJson('/api/v1/approvals/bulk', { ids: ['missing-id'], action: 'reject' }, confirm)
    ).json();
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { id: 'missing-id', statusCode: 404, message: expect.any(String) },
    ]);
  });
});

describe('triggers contract', () => {
  test('actions and notification-triggers split by provider type', async () => {
    const actions = await getJson('/api/v1/actions');
    const notificationTriggers = await getJson('/api/v1/notification-triggers');
    expect(actions.data.length).toBeGreaterThan(0);
    expect(notificationTriggers.data.length).toBeGreaterThan(0);
    for (const action of actions.data) {
      expect(['docker', 'dockercompose', 'portainer', 'command']).toContain(action.type);
    }
    for (const trigger of notificationTriggers.data) {
      expect(['docker', 'dockercompose', 'portainer', 'command']).not.toContain(trigger.type);
      expect(trigger).toMatchObject({ id: expect.any(String), name: expect.any(String) });
    }
    const ids = notificationTriggers.data.map((t: { id: string }) => t.id);
    expect(ids).toContain('slack.homelab');
  });

  test('trigger detail resolves from the matching collection', async () => {
    const detail = await getJson('/api/v1/notification-triggers/slack/homelab');
    expect(detail).toMatchObject({ id: 'slack.homelab', type: 'slack', name: 'homelab' });
    const action = await getJson('/api/v1/actions/docker/local');
    expect(action).toMatchObject({ type: 'docker', name: 'local' });
    expect((await fetch(`${base}/api/v1/actions/slack/homelab`)).status).toBe(404);
  });

  test('every notification rule trigger id exists in the notification triggers', async () => {
    const rules = await getJson('/api/v1/notifications');
    const triggers = await getJson('/api/v1/notification-triggers');
    const known = new Set(triggers.data.map((t: { id: string }) => t.id));
    for (const rule of rules.data) {
      for (const id of rule.triggers) {
        expect(known.has(id), `${rule.id} -> ${id}`).toBe(true);
      }
    }
  });
});

describe('images contract', () => {
  test('inventory returns images and hosts derived from the demo containers', async () => {
    const payload = await getJson('/api/v1/images');
    expect(payload).toMatchObject({
      data: expect.any(Array),
      total: payload.data.length,
      hosts: expect.any(Array),
    });
    expect(payload.hosts.length).toBeGreaterThan(0);
    for (const host of payload.hosts) {
      expect(host).toMatchObject({ id: expect.any(String), name: expect.any(String) });
      expect(typeof host.supported).toBe('boolean');
    }
    const repoTags = payload.data.flatMap((image: { repoTags: string[] }) => image.repoTags);
    expect(repoTags).toContain('grafana/grafana:11.3.0');
    const grafana = payload.data.find((image: { repoTags: string[] }) =>
      image.repoTags.includes('grafana/grafana:11.3.0'),
    );
    expect(grafana).toMatchObject({
      id: expect.stringMatching(/^sha256:/),
      repoDigests: expect.any(Array),
      size: expect.any(Number),
      reclaimable: expect.any(Number),
      created: expect.any(String),
      containers: 1,
      dangling: false,
      watcher: 'local',
    });
    expect(payload.data.some((image: { dangling: boolean }) => image.dangling)).toBe(true);
  });

  test('host filter, prune preview and prune', async () => {
    const all = await getJson('/api/v1/images');
    const host = all.hosts[0].id;
    const filtered = await getJson(`/api/v1/images?host=${host}`);
    expect(filtered.data.length).toBeLessThanOrEqual(all.data.length);
    expect((await fetch(`${base}/api/v1/images?host=nope`)).status).toBe(404);

    const preview = await getJson(`/api/v1/images/prune-preview?host=${host}&mode=dangling`);
    expect(preview).toEqual({
      host,
      mode: 'dangling',
      images: expect.any(Number),
      reclaimable: expect.any(Number),
    });
    expect((await fetch(`${base}/api/v1/images/prune-preview?host=${host}&mode=bad`)).status).toBe(
      400,
    );

    expect((await postJson('/api/v1/images/prune', '{')).status).toBe(400);
    const pruned = await (
      await postJson('/api/v1/images/prune', { host, mode: 'dangling' })
    ).json();
    expect(pruned).toEqual({
      message: expect.any(String),
      result: {
        host,
        mode: 'dangling',
        imagesDeleted: preview.images,
        spaceReclaimed: preview.reclaimable,
      },
    });
    const after = await getJson(`/api/v1/images/prune-preview?host=${host}&mode=dangling`);
    expect(after.images).toBe(0);
  });
});
