/**
 * The role matrix, asserted against the live Express router.
 *
 * Every route under /api/v1 is enumerated off the router stack, the same way
 * the scope completeness test does it, and then driven for each role: a role
 * below a route's floor must get 403 from the real `scoped()` wrapper before
 * the handler runs, and a role at or above it must be let through. The pinned
 * list below is the published matrix; a route that changes floor, or a new
 * route, is a deliberate line in a diff.
 *
 * `handler` marks the eight dynamic trigger routes, whose floor follows the
 * trigger they resolve (operator either way); they are driven separately.
 */

import type { Request, Response } from 'express';
import { ROLES, type Role, roleAtLeast } from './roles.js';
import { ROLE_DENIED_MESSAGE, type RouteScope, resolveRoleFloor } from './route-scopes.js';

const EXPECTED_ROLE_MATRIX = [
  'DELETE /api/v1/api-keys/:keyId → admin',
  'DELETE /api/v1/auth/totp-enrollments/:id → viewer',
  'DELETE /api/v1/auth/totp-factor → viewer',
  'DELETE /api/v1/containers/:id → admin',
  'DELETE /api/v1/containers/:id/label-overrides → admin',
  'DELETE /api/v1/group-policies/:id → admin',
  'DELETE /api/v1/icons/cache → admin',
  'DELETE /api/v1/label-overrides/:overrideId → admin',
  'DELETE /api/v1/notifications/outbox/:id → operator',
  'DELETE /api/v1/notifications/silences/:id → admin',
  'DELETE /api/v1/portwing/keys/:keyId → admin',
  'GET /api/v1/actions → viewer',
  'GET /api/v1/actions/:type/:name → viewer',
  'GET /api/v1/actions/:type/:name/:agent → viewer',
  'GET /api/v1/actions/:type/:name/:agent/skips → viewer',
  'GET /api/v1/actions/:type/:name/skips → viewer',
  'GET /api/v1/agents → viewer',
  'GET /api/v1/agents/:name/key-rotation → admin',
  'GET /api/v1/agents/:name/log/entries → viewer',
  'GET /api/v1/agents/roster → viewer',
  'GET /api/v1/api-keys → admin',
  'GET /api/v1/app → viewer',
  'GET /api/v1/approvals → viewer',
  'GET /api/v1/approvals/:id → viewer',
  'GET /api/v1/approvals/summary → viewer',
  'GET /api/v1/audit → viewer',
  'GET /api/v1/audit/export → viewer',
  'GET /api/v1/auth/totp-factor → viewer',
  'GET /api/v1/authentications → viewer',
  'GET /api/v1/authentications/:type/:name → viewer',
  'GET /api/v1/authentications/:type/:name/:agent → viewer',
  'GET /api/v1/cleanup → viewer',
  'GET /api/v1/config → admin',
  'GET /api/v1/config/:section → admin',
  'GET /api/v1/config/editor/actions → admin',
  'GET /api/v1/config/editor/triggers → admin',
  'GET /api/v1/config/editor/watchers → admin',
  'GET /api/v1/containers → viewer',
  'GET /api/v1/containers/:id → viewer',
  'GET /api/v1/containers/:id/backups → viewer',
  'GET /api/v1/containers/:id/effective-policy → viewer',
  'GET /api/v1/containers/:id/intermediate-release-notes → viewer',
  'GET /api/v1/containers/:id/label-overrides → viewer',
  'GET /api/v1/containers/:id/logs → viewer',
  'GET /api/v1/containers/:id/release-notes → viewer',
  'GET /api/v1/containers/:id/sbom → viewer',
  'GET /api/v1/containers/:id/stats → viewer',
  'GET /api/v1/containers/:id/stats/stream → viewer',
  'GET /api/v1/containers/:id/triggers → viewer',
  'GET /api/v1/containers/:id/update-operations → viewer',
  'GET /api/v1/containers/:id/vulnerabilities → viewer',
  'GET /api/v1/containers/backups → viewer',
  'GET /api/v1/containers/dependencies → viewer',
  'GET /api/v1/containers/groups → viewer',
  'GET /api/v1/containers/recent-status → viewer',
  'GET /api/v1/containers/security/vulnerabilities → viewer',
  'GET /api/v1/containers/stats → viewer',
  'GET /api/v1/containers/summary → viewer',
  'GET /api/v1/debug/dump → admin',
  'GET /api/v1/events/ui → viewer',
  'GET /api/v1/group-policies → viewer',
  'GET /api/v1/group-policies/:id → viewer',
  'GET /api/v1/icons/:provider/:slug → viewer',
  'GET /api/v1/images → viewer',
  'GET /api/v1/images/prune-preview → admin',
  'GET /api/v1/label-overrides → viewer',
  'GET /api/v1/log → viewer',
  'GET /api/v1/log/components → viewer',
  'GET /api/v1/log/entries → viewer',
  'GET /api/v1/notification-triggers → viewer',
  'GET /api/v1/notification-triggers/:type/:name → viewer',
  'GET /api/v1/notification-triggers/:type/:name/:agent → viewer',
  'GET /api/v1/notification-triggers/:type/:name/:agent/skips → viewer',
  'GET /api/v1/notification-triggers/:type/:name/skips → viewer',
  'GET /api/v1/notifications → viewer',
  'GET /api/v1/notifications/outbox → viewer',
  'GET /api/v1/notifications/silences → viewer',
  'GET /api/v1/openapi.json → viewer',
  'GET /api/v1/portwing/keys → admin',
  'GET /api/v1/preferences → viewer',
  'GET /api/v1/registries → viewer',
  'GET /api/v1/registries/:type/:name → viewer',
  'GET /api/v1/registries/:type/:name/:agent → viewer',
  'GET /api/v1/self-update/:operationId/status → exempt',
  'GET /api/v1/server → viewer',
  'GET /api/v1/server/security/runtime → viewer',
  'GET /api/v1/settings → viewer',
  'GET /api/v1/stats/summary → viewer',
  'GET /api/v1/stats/summary/stream → viewer',
  'GET /api/v1/store → viewer',
  'GET /api/v1/triggers → viewer',
  'GET /api/v1/triggers/:type/:name → viewer',
  'GET /api/v1/triggers/:type/:name/:agent → viewer',
  'GET /api/v1/triggers/:type/:name/:agent/skips → viewer',
  'GET /api/v1/triggers/:type/:name/skips → viewer',
  'GET /api/v1/update-operations/:id → viewer',
  'GET /api/v1/watchers → viewer',
  'GET /api/v1/watchers/:type/:name → viewer',
  'GET /api/v1/watchers/:type/:name/:agent → viewer',
  'GET /api/v1/{*path} → viewer',
  'PATCH /api/v1/config/editor/actions → admin',
  'PATCH /api/v1/config/editor/triggers → admin',
  'PATCH /api/v1/config/editor/watchers → admin',
  'PATCH /api/v1/containers/:id/label-overrides → admin',
  'PATCH /api/v1/containers/:id/update-policy → operator',
  'PATCH /api/v1/notifications/:id → admin',
  'PATCH /api/v1/preferences → viewer',
  'PATCH /api/v1/settings → admin',
  'POST /api/v1/actions/:type/:name → handler',
  'POST /api/v1/actions/:type/:name/:agent → handler',
  'POST /api/v1/agents/:name/key-rotation → admin',
  'POST /api/v1/api-keys → admin',
  'POST /api/v1/approvals/:id/approve → operator',
  'POST /api/v1/approvals/:id/defer → operator',
  'POST /api/v1/approvals/:id/reject → operator',
  'POST /api/v1/approvals/bulk → operator',
  'POST /api/v1/auth/totp-enrollments → viewer',
  'POST /api/v1/auth/totp-recovery-code-sets → viewer',
  'POST /api/v1/cleanup/run → admin',
  'POST /api/v1/config/reload → admin',
  'POST /api/v1/config/validate → admin',
  'POST /api/v1/containers/:id/env/reveal → admin',
  'POST /api/v1/containers/:id/preview → operator',
  'POST /api/v1/containers/:id/restart → operator',
  'POST /api/v1/containers/:id/rollback → operator',
  'POST /api/v1/containers/:id/scan → operator',
  'POST /api/v1/containers/:id/start → operator',
  'POST /api/v1/containers/:id/stop → operator',
  'POST /api/v1/containers/:id/triggers/:triggerType/:triggerName → handler',
  'POST /api/v1/containers/:id/triggers/:triggerType/:triggerName/:triggerAgent → handler',
  'POST /api/v1/containers/:id/update → operator',
  'POST /api/v1/containers/:id/update-chain-preview → operator',
  'POST /api/v1/containers/:id/watch → operator',
  'POST /api/v1/containers/scan-all → operator',
  'POST /api/v1/containers/update → operator',
  'POST /api/v1/containers/watch → operator',
  'POST /api/v1/dependency-groups/:rootId/update → operator',
  'POST /api/v1/events/ui/self-update/:operationId/ack → admin',
  'POST /api/v1/group-policies → admin',
  'POST /api/v1/images/prune → admin',
  'POST /api/v1/internal/self-update/finalize → exempt',
  'POST /api/v1/notification-triggers/:type/:name → handler',
  'POST /api/v1/notification-triggers/:type/:name/:agent → handler',
  'POST /api/v1/notifications/:id/preview → operator',
  'POST /api/v1/notifications/outbox/:id/retry → operator',
  'POST /api/v1/notifications/silences → admin',
  'POST /api/v1/operations/:id/cancel → operator',
  'POST /api/v1/portwing/keys → admin',
  'POST /api/v1/server/security/assets/:provider/:operation → admin',
  'POST /api/v1/triggers/:type/:name → handler',
  'POST /api/v1/triggers/:type/:name/:agent → handler',
  'POST /api/v1/watchers/:type/:name/:agent/inventory → operator',
  'POST /api/v1/watchers/:type/:name/inventory → operator',
  'POST /api/v1/webhook/update/:containerName → exempt',
  'POST /api/v1/webhook/watch → exempt',
  'POST /api/v1/webhook/watch/:containerName → exempt',
  'POST /api/v1/webhooks/registry → exempt',
  'POST /api/v1/webhooks/registry/:provider → exempt',
  'POST /api/v1/webhooks/registry/:provider/:secret → exempt',
  'PUT /api/v1/auth/totp-enrollments/:id → viewer',
  'PUT /api/v1/config/:section → admin',
  'PUT /api/v1/group-policies/:id → admin',
  'PUT /api/v1/settings → admin',
];

const mockGetExperimentalPortwingEnabled = vi.hoisted(() => vi.fn(() => true));
vi.mock('../configuration/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../configuration/index.js')>();
  return {
    ...actual,
    getExperimentalPortwingEnabled: mockGetExperimentalPortwingEnabled,
  };
});

const ROUTE_SCOPE = Symbol.for('drydock.api.routeScope');
const ROUTE_ROLE = Symbol.for('drydock.api.routeRole');
const MOUNT_PATH = Symbol.for('drydock.api.mountPath');

type Handle = ((req: unknown, res: unknown, next?: unknown) => unknown) & Record<symbol, unknown>;

interface LiveRoute {
  method: string;
  path: string;
  scope: RouteScope;
  floor?: string;
  handle: Handle;
}

interface LayerLike {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle?: unknown }[] };
  handle?: unknown;
}

/** Walk the router stack and keep the scoped handle each route runs. */
function walk(stack: LayerLike[], basePath: string, routes: LiveRoute[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const declared = layer.route.stack
        .map((entry) => entry.handle as Handle | undefined)
        .find((handle) => typeof handle?.[ROUTE_SCOPE] === 'string');
      if (!declared) {
        continue;
      }
      const suffix = layer.route.path === '/' ? '' : layer.route.path;
      for (const method of Object.keys(layer.route.methods).filter(
        (name) => layer.route?.methods[name],
      )) {
        routes.push({
          method: method.toUpperCase(),
          path: `${basePath}${suffix}` || '/',
          scope: declared[ROUTE_SCOPE] as RouteScope,
          floor: declared[ROUTE_ROLE] as string | undefined,
          handle: declared,
        });
      }
      continue;
    }
    const child = layer.handle as { stack?: LayerLike[] } & Record<symbol, unknown>;
    if (child && Array.isArray(child.stack)) {
      walk(child.stack, `${basePath}${child[MOUNT_PATH] as string}`, routes);
    }
  }
}

function effectiveFloor(route: LiveRoute): string {
  return resolveRoleFloor(route.scope, route.floor as never) ?? 'handler';
}

function format(route: LiveRoute): string {
  return `${route.method} ${route.path} → ${effectiveFloor(route)}`;
}

function personOf(role: Role) {
  return { kind: 'session' as const, username: `${role}-user`, role };
}

function createResponse() {
  const json = vi.fn();
  const res = {
    status: vi.fn(() => ({ json })),
    json,
    setHeader: vi.fn(),
    sendStatus: vi.fn(),
  };
  return { res: res as unknown as Response, status: res.status, json };
}

function requestFor(role: Role, route: LiveRoute): Request {
  return {
    principal: personOf(role),
    method: route.method,
    params: {},
    query: {},
    body: {},
    headers: {},
  } as unknown as Request;
}

describe('role matrix', () => {
  let routes: LiveRoute[];

  beforeAll(async () => {
    const api = await import('./api.js');
    const router = api.init() as unknown as { stack: LayerLike[] };
    routes = [];
    walk(router.stack, '/api/v1', routes);
  });

  test('every route publishes the floor in the matrix', () => {
    expect(routes.map(format).sort()).toStrictEqual(EXPECTED_ROLE_MATRIX);
  });

  test('a role below the floor gets 403 from the live wrapper before the handler runs', async () => {
    const misses: string[] = [];
    for (const route of routes) {
      const floor = effectiveFloor(route);
      if (floor === 'handler' || floor === 'exempt') {
        continue;
      }
      for (const role of ROLES.filter((candidate) => !roleAtLeast(candidate, floor as Role))) {
        const { res, status, json } = createResponse();
        const next = vi.fn();
        await route.handle(requestFor(role, route), res, next);
        const denied =
          status.mock.calls[0]?.[0] === 403 &&
          json.mock.calls[0]?.[0]?.error === ROLE_DENIED_MESSAGE;
        if (!denied || next.mock.calls.length > 0) {
          misses.push(`${role} reached ${format(route)}`);
        }
      }
    }
    expect(misses).toStrictEqual([]);
  });

  test('a viewer gets 403 on every dynamic trigger route, which needs operator', async () => {
    const dynamic = routes.filter((route) => effectiveFloor(route) === 'handler');
    expect(dynamic).toHaveLength(8);

    for (const route of dynamic) {
      const { res, status, json } = createResponse();
      const req = requestFor('viewer', route);
      (req as unknown as { params: Record<string, string> }).params = {
        id: 'c1',
        type: 'docker',
        name: 'local',
        triggerType: 'docker',
        triggerName: 'local',
      };
      await route.handle(req, res, vi.fn());

      expect(status, format(route)).toHaveBeenCalledWith(403);
      expect(json.mock.calls[0]?.[0]).toMatchObject({
        error: ROLE_DENIED_MESSAGE,
        details: { requiredRole: 'operator' },
      });
    }
  });

  test('an exempt route never denies on role, whoever rides along', () => {
    const exempt = routes.filter((route) => effectiveFloor(route) === 'exempt').map(format);
    expect(exempt.sort()).toStrictEqual([
      'GET /api/v1/self-update/:operationId/status → exempt',
      'POST /api/v1/internal/self-update/finalize → exempt',
      'POST /api/v1/webhook/update/:containerName → exempt',
      'POST /api/v1/webhook/watch → exempt',
      'POST /api/v1/webhook/watch/:containerName → exempt',
      'POST /api/v1/webhooks/registry → exempt',
      'POST /api/v1/webhooks/registry/:provider → exempt',
      'POST /api/v1/webhooks/registry/:provider/:secret → exempt',
    ]);
  });

  test('viewers can read, operators can act, only admins administer', () => {
    const floorOf = (line: string) =>
      routes.find((route) => `${route.method} ${route.path}` === line);
    expect(effectiveFloor(floorOf('GET /api/v1/containers') as LiveRoute)).toBe('viewer');
    expect(effectiveFloor(floorOf('GET /api/v1/audit') as LiveRoute)).toBe('viewer');
    expect(effectiveFloor(floorOf('PATCH /api/v1/preferences') as LiveRoute)).toBe('viewer');
    expect(effectiveFloor(floorOf('POST /api/v1/containers/:id/update') as LiveRoute)).toBe(
      'operator',
    );
    expect(effectiveFloor(floorOf('POST /api/v1/containers/:id/restart') as LiveRoute)).toBe(
      'operator',
    );
    expect(effectiveFloor(floorOf('POST /api/v1/approvals/:id/approve') as LiveRoute)).toBe(
      'operator',
    );
    expect(effectiveFloor(floorOf('PATCH /api/v1/settings') as LiveRoute)).toBe('admin');
    expect(effectiveFloor(floorOf('DELETE /api/v1/containers/:id') as LiveRoute)).toBe('admin');
    expect(effectiveFloor(floorOf('GET /api/v1/config') as LiveRoute)).toBe('admin');
    expect(effectiveFloor(floorOf('POST /api/v1/api-keys') as LiveRoute)).toBe('admin');
  });
});
