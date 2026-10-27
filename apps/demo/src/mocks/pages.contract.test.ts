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

async function send(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${base}${path}`, {
    method,
    headers: { ...jsonHeaders, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('container actions contract', () => {
  test('bulk update accepts updatable containers, rejects the rest, and tracks operations', async () => {
    expect((await postJson('/api/v1/containers/update', { containerIds: [] })).status).toBe(400);
    const updatable = containers.find((c) => c.updateAvailable);
    const current = containers.find((c) => !c.updateAvailable);
    expect(updatable && current).toBeTruthy();
    const result = await (
      await postJson('/api/v1/containers/update', {
        containerIds: [updatable?.id, current?.id, 'nope'],
      })
    ).json();
    expect(result.message).toEqual(expect.any(String));
    expect(result.accepted).toEqual([
      {
        containerId: updatable?.id,
        containerName: updatable?.name,
        operationId: expect.any(String),
      },
    ]);
    expect(result.rejected.map((r: { statusCode: number }) => r.statusCode)).toEqual([409, 404]);

    const operation = await getJson(`/api/v1/update-operations/${result.accepted[0].operationId}`);
    expect(operation).toMatchObject({
      id: result.accepted[0].operationId,
      containerId: updatable?.id,
      status: expect.stringMatching(/^(queued|in-progress|succeeded)$/),
    });
    expect((await fetch(`${base}/api/v1/update-operations/missing`)).status).toBe(404);

    const cancelled = await send('POST', `/api/v1/operations/${operation.id}/cancel`);
    expect([200, 202]).toContain(cancelled.status);
    const after = await getJson(`/api/v1/update-operations/${operation.id}`);
    expect(after.status).toBe('rolled-back');
    expect((await send('POST', `/api/v1/operations/${operation.id}/cancel`)).status).toBe(409);
    expect((await send('POST', '/api/v1/operations/missing/cancel')).status).toBe(404);
  });

  test('dependency graph, chain preview and group update agree', async () => {
    const graph = await getJson('/api/v1/containers/dependencies');
    expect(graph).toMatchObject({
      nodes: expect.any(Array),
      edges: expect.any(Array),
      cycles: [],
      unresolved: [],
      crossHostIgnored: [],
    });
    const ids = new Set(containers.map((c) => c.id));
    for (const node of graph.nodes) expect(ids.has(node.id)).toBe(true);
    const grafana = containers.find((c) => c.name === 'grafana');
    const preview = await (
      await send('POST', `/api/v1/containers/${grafana?.id}/update-chain-preview`)
    ).json();
    expect(preview.waves.length).toBeGreaterThan(1);
    expect(preview.waves.at(-1).containers.map((c: { name: string }) => c.name)).toContain(
      'grafana',
    );
    expect(preview.warnings).toEqual({ cycles: [], unresolved: [] });
    expect((await send('POST', '/api/v1/containers/nope/update-chain-preview')).status).toBe(404);

    expect((await send('POST', `/api/v1/dependency-groups/${grafana?.id}/update`, {})).status).toBe(
      428,
    );
    const confirm = { 'X-DD-Confirm-Action': 'dependency-group-update' };
    const mismatch = await send(
      'POST',
      `/api/v1/dependency-groups/${grafana?.id}/update`,
      { expectedContainerIds: ['x'] },
      confirm,
    );
    expect(mismatch.status).toBe(409);
    const expected = preview.waves.flatMap((w: { containers: { id: string }[] }) =>
      w.containers.map((c) => c.id),
    );
    const ran = await (
      await send(
        'POST',
        `/api/v1/dependency-groups/${grafana?.id}/update`,
        { expectedContainerIds: expected },
        confirm,
      )
    ).json();
    expect(ran.accepted.length + ran.rejected.length).toBe(expected.length);
    for (const item of ran.accepted) {
      expect(item).toMatchObject({ wave: expect.any(Number), actionKind: expect.any(String) });
    }
  });

  test('scan-all, intermediate release notes and log components', async () => {
    const scan = await (await postJson('/api/v1/containers/scan-all', { requestId: 'r1' })).json();
    expect(scan).toEqual({
      cycleId: expect.any(String),
      scheduledCount: expect.any(Number),
      requestId: 'r1',
    });
    expect(scan.scheduledCount).toBeGreaterThan(0);

    const grafana = containers.find((c) => c.name === 'grafana');
    const notes = await getJson(
      `/api/v1/containers/${grafana?.id}/intermediate-release-notes?from=11.3.0&to=11.4.0`,
    );
    expect(notes.releaseNotes.length).toBeGreaterThan(0);
    expect(notes.hiddenCount).toBe(0);
    expect(
      (await fetch(`${base}/api/v1/containers/${grafana?.id}/intermediate-release-notes`)).status,
    ).toBe(400);
    expect(
      (await fetch(`${base}/api/v1/containers/nope/intermediate-release-notes?from=1&to=2`)).status,
    ).toBe(404);

    const components = await getJson('/api/v1/log/components');
    expect(components).toContain('api');
  });

  test('stats summary covers the running containers', async () => {
    const { data } = await getJson('/api/v1/stats/summary');
    const running = containers.filter((c) => c.status === 'running').length;
    expect(data).toMatchObject({
      timestamp: expect.any(String),
      watchedCount: running,
      avgCpuPercent: expect.any(Number),
      totalMemoryUsageBytes: expect.any(Number),
      totalMemoryLimitBytes: expect.any(Number),
      totalMemoryPercent: expect.any(Number),
    });
    expect(data.topCpu.length).toBeGreaterThan(0);
    expect(data.topMemory[0]).toMatchObject({
      id: expect.any(String),
      cpuPercent: expect.any(Number),
    });
  });
});

describe('label overrides contract', () => {
  test('patch is visible on the next get, stale revisions conflict, delete resets', async () => {
    const id = containers[0].id;
    const path = `/api/v1/containers/${id}/label-overrides`;
    const initial = await getJson(path);
    expect(initial).toMatchObject({
      containerId: id,
      overrideId: null,
      revision: 0,
      readOnlyReason: null,
      scope: { kind: 'container', appliesTo: [{ id, name: containers[0].name }] },
      warnings: [],
    });
    expect(Object.keys(initial.fields)).toContain('displayName');
    expect((await fetch(`${base}/api/v1/containers/nope/label-overrides`)).status).toBe(404);

    const patched = await (
      await send('PATCH', path, {
        revision: 0,
        changes: [{ field: 'displayName', op: 'set', value: 'Demo Grafana' }],
      })
    ).json();
    expect(patched.changed).toEqual(['displayName']);
    expect(patched.revision).toBe(1);
    const after = await getJson(path);
    expect(after.fields.displayName.effective).toEqual({
      value: 'Demo Grafana',
      source: 'override',
    });
    expect(after.fields.displayName.override.value).toBe('Demo Grafana');

    const stale = await send('PATCH', path, {
      revision: 0,
      changes: [{ field: 'displayName', op: 'remove' }],
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).snapshot.revision).toBe(1);
    expect(
      (
        await send('PATCH', path, {
          revision: 1,
          changes: [{ field: 'bogus', op: 'set', value: 'x' }],
        })
      ).status,
    ).toBe(400);

    const reset = await send('DELETE', `${path}?revision=1&overrideId=${after.overrideId}`);
    expect(reset.status).toBe(200);
    const final = await getJson(path);
    expect(final.fields.displayName.override).toBeNull();
    expect(final.revision).toBe(0);
  });
});

describe('preferences contract', () => {
  test('patch is visible on the next get and validates the api version', async () => {
    const empty = await getJson('/api/v1/preferences');
    expect(empty).toMatchObject({ apiVersion: 1, username: 'demo', preferences: null });
    expect((await send('PATCH', '/api/v1/preferences', { apiVersion: 2 })).status).toBe(409);
    expect(
      (
        await send('PATCH', '/api/v1/preferences', {
          apiVersion: 1,
          schemaVersion: 0,
          preferences: {},
        })
      ).status,
    ).toBe(400);
    const saved = await (
      await send('PATCH', '/api/v1/preferences', {
        apiVersion: 1,
        schemaVersion: 3,
        preferences: { layout: { sidebarCollapsed: true } },
      })
    ).json();
    expect(saved.schemaVersion).toBe(3);
    const after = await getJson('/api/v1/preferences');
    expect(after.preferences).toEqual({ layout: { sidebarCollapsed: true } });
    expect(after.updatedAt).toEqual(expect.any(String));
  });
});

describe('config editor contract', () => {
  test.each([
    ['watchers', 'watchers', 'cron'],
    ['triggers', 'triggers', 'threshold'],
    ['actions', 'actions', 'auto'],
  ])('%s snapshot and patch', async (segment, key, field) => {
    const path = `/api/v1/config/editor/${segment}`;
    const snapshot = await getJson(path);
    expect(snapshot).toMatchObject({ available: true, revision: expect.any(String) });
    const rows = snapshot[key];
    expect(rows.length).toBeGreaterThan(0);
    const descriptor = rows[0].fields[field];
    expect(descriptor.path).toEqual(expect.any(Array));

    const stale = await send('PATCH', path, { revision: 'stale', changes: [] });
    expect(stale.status).toBe(409);
    const outcome = await send('PATCH', path, {
      revision: snapshot.revision,
      changes: [{ path: descriptor.path, operation: 'set', value: 'demo-value' }],
    });
    expect(outcome.status).toBe(200);
    expect(await outcome.json()).toMatchObject({
      saved: true,
      applied: true,
      errors: [],
      restartRequired: [],
      changedKeys: [
        `DD_${descriptor.path
          .join('_')
          .toUpperCase()
          .replace(/[^A-Z0-9_]/g, '_')}`,
      ],
    });
    const after = await getJson(path);
    expect(after.revision).not.toBe(snapshot.revision);
    expect(after[key][0].fields[field]).toMatchObject({ present: true, value: 'demo-value' });
  });
});

describe('trigger skips contract', () => {
  test('notification triggers return a page, actions return an empty page, unknown 404', async () => {
    const page = await getJson(
      '/api/v1/notification-triggers/slack/homelab/skips?limit=1&offset=0',
    );
    expect(page).toMatchObject({ total: expect.any(Number), limit: 1, offset: 0 });
    expect(page.data).toHaveLength(1);
    expect(page.hasMore).toBe(page.total > 1);
    expect(page.data[0]).toMatchObject({
      containerId: expect.any(String),
      reason: expect.any(String),
      at: expect.any(String),
    });
    const action = await getJson('/api/v1/actions/docker/local/skips');
    expect(action).toMatchObject({ data: [], total: 0, hasMore: false });
    expect((await fetch(`${base}/api/v1/notification-triggers/nope/nope/skips`)).status).toBe(404);
    expect((await fetch(`${base}/api/v1/actions/nope/nope/agent/skips`)).status).toBe(404);
  });
});

describe('group policies contract', () => {
  test('create, replace and delete are reflected in the list', async () => {
    const list = await getJson('/api/v1/group-policies');
    expect(list.total).toBe(list.data.length);
    expect(list.data[0]).toMatchObject({
      id: expect.any(String),
      group: 'monitoring',
      revision: 1,
      members: { count: expect.any(Number), agents: [null] },
    });
    expect(list.data[0].members.count).toBeGreaterThan(0);

    const dup = await send('POST', '/api/v1/group-policies', { group: 'monitoring' });
    expect(dup.status).toBe(409);
    expect((await send('POST', '/api/v1/group-policies', { group: '' })).status).toBe(400);

    const created = await send('POST', '/api/v1/group-policies', {
      group: 'media',
      actions: { updateMode: 'manual' },
    });
    expect(created.status).toBe(201);
    const { policy, applied, warnings } = await created.json();
    expect(policy).toMatchObject({
      group: 'media',
      revision: 1,
      actions: { updateMode: 'manual' },
    });
    expect(applied.members).toBe(policy.members.count);
    expect(warnings).toEqual([]);
    expect(
      (await getJson('/api/v1/group-policies')).data.map((p: { group: string }) => p.group),
    ).toContain('media');

    expect(
      (
        await send('PUT', `/api/v1/group-policies/${policy.id}`, {
          revision: 9,
          actions: { updateMode: 'notify' },
        })
      ).status,
    ).toBe(409);
    const replaced = await (
      await send('PUT', `/api/v1/group-policies/${policy.id}`, {
        revision: 1,
        actions: { updateMode: 'notify' },
      })
    ).json();
    expect(replaced).toMatchObject({ changed: true, policy: { revision: 2 } });
    expect(replaced.policy.actions.updateMode).toBe('notify');
    expect((await send('PUT', '/api/v1/group-policies/nope', { revision: 1 })).status).toBe(404);

    expect((await send('DELETE', `/api/v1/group-policies/${policy.id}?revision=1`)).status).toBe(
      409,
    );
    const deleted = await send('DELETE', `/api/v1/group-policies/${policy.id}?revision=2`);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ changed: true, policy: { id: policy.id } });
    expect(
      (await getJson('/api/v1/group-policies')).data.map((p: { id: string }) => p.id),
    ).not.toContain(policy.id);
  });
});

describe('api keys contract', () => {
  test('create returns a clearly fake credential once, revoke needs confirmation', async () => {
    const page = await getJson('/api/v1/api-keys?limit=50');
    expect(page).toMatchObject({ data: expect.any(Array), total: page.data.length });
    expect(page.nextCursor).toBeUndefined();
    for (const key of page.data) expect(key).not.toHaveProperty('apiKey');

    expect((await send('POST', '/api/v1/api-keys', { name: 'x', scopes: ['nope'] })).status).toBe(
      400,
    );
    expect((await send('POST', '/api/v1/api-keys', { name: '', scopes: ['read'] })).status).toBe(
      400,
    );
    const created = await send('POST', '/api/v1/api-keys', { name: 'demo-key', scopes: ['read'] });
    expect(created.status).toBe(201);
    const key = await created.json();
    expect(key).toMatchObject({ name: 'demo-key', scopes: ['read'], status: 'active' });
    expect(key.apiKey).toMatch(/^dd_demo_/);
    expect(key.displayPrefix).toBe(key.apiKey.slice(0, key.displayPrefix.length));
    const listed = await getJson('/api/v1/api-keys');
    const row = listed.data.find((k: { keyId: string }) => k.keyId === key.keyId);
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty('apiKey');

    expect((await send('DELETE', `/api/v1/api-keys/${key.keyId}`)).status).toBe(428);
    const revoked = await send('DELETE', `/api/v1/api-keys/${key.keyId}`, undefined, {
      'X-DD-Confirm-Action': 'api-key-revoke',
    });
    expect(await revoked.json()).toEqual({
      keyId: key.keyId,
      revokedKeyIds: [key.keyId],
      cascadeCount: 1,
    });
    const after = await getJson('/api/v1/api-keys');
    expect(after.data.find((k: { keyId: string }) => k.keyId === key.keyId).status).toBe('revoked');
    expect(
      (
        await send('DELETE', '/api/v1/api-keys/nope', undefined, {
          'X-DD-Confirm-Action': 'api-key-revoke',
        })
      ).status,
    ).toBe(404);
  });
});

describe('totp and login challenge contract', () => {
  test('enrol, confirm, regenerate codes and remove the factor', async () => {
    const start = await getJson('/api/v1/auth/totp-factor');
    expect(start).toEqual({ status: 'unenrolled', recoveryCodesRemaining: 0 });

    expect((await send('POST', '/api/v1/auth/totp-enrollments', {})).status).toBe(400);
    const enrollment = await (
      await send('POST', '/api/v1/auth/totp-enrollments', { password: 'demo' })
    ).json();
    expect(enrollment).toMatchObject({
      id: expect.any(String),
      secret: expect.any(String),
      otpauthUri: expect.stringMatching(/^otpauth:\/\/totp\//),
      expiresAt: expect.any(String),
      replacesFactor: false,
    });
    const pending = await getJson('/api/v1/auth/totp-factor');
    expect(pending.pendingEnrollment).toMatchObject({ id: enrollment.id });

    expect(
      (await send('PUT', `/api/v1/auth/totp-enrollments/${enrollment.id}`, { code: 'abc' })).status,
    ).toBe(401);
    const confirmed = await (
      await send('PUT', `/api/v1/auth/totp-enrollments/${enrollment.id}`, { code: '123456' })
    ).json();
    expect(confirmed.recoveryCodes.length).toBeGreaterThan(0);
    const active = await getJson('/api/v1/auth/totp-factor');
    expect(active).toMatchObject({
      status: 'active',
      activatedAt: expect.any(String),
      recoveryCodesRemaining: confirmed.recoveryCodes.length,
    });
    expect(active.pendingEnrollment).toBeUndefined();

    expect(
      (await send('POST', '/api/v1/auth/totp-recovery-code-sets', { password: 'demo' })).status,
    ).toBe(401);
    const regenerated = await (
      await send('POST', '/api/v1/auth/totp-recovery-code-sets', {
        password: 'demo',
        code: '123456',
      })
    ).json();
    expect(regenerated.recoveryCodes).not.toEqual(confirmed.recoveryCodes);

    expect((await send('DELETE', '/api/v1/auth/totp-factor', { password: 'demo' })).status).toBe(
      401,
    );
    expect(
      (await send('DELETE', '/api/v1/auth/totp-factor', { password: 'demo', code: '123456' }))
        .status,
    ).toBe(204);
    expect((await getJson('/api/v1/auth/totp-factor')).status).toBe('unenrolled');

    const second = await (
      await send('POST', '/api/v1/auth/totp-enrollments', { password: 'demo' })
    ).json();
    expect((await send('DELETE', `/api/v1/auth/totp-enrollments/${second.id}`)).status).toBe(204);
    expect((await getJson('/api/v1/auth/totp-factor')).pendingEnrollment).toBeUndefined();
  });

  test('login challenge completion, cancel and api key review acknowledge', async () => {
    const done = await send('PUT', '/auth/login-challenges/abc', {
      code: '123456',
      remember: false,
    });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ username: 'demo' });
    expect((await send('DELETE', '/auth/login-challenges/abc')).status).toBe(204);
    expect((await send('POST', '/auth/api-key-review/acknowledge')).status).toBe(204);
  });
});
