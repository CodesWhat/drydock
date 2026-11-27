import express from 'express';
import { requireAuthentication } from './auth.js';
import {
  collectRouteScopes,
  DYNAMIC_SCOPE,
  findUndeclaredRoutes,
  findUnflooredSessionOnlyRoutes,
  formatRouteScope,
  type RouteScopeDeclaration,
  SESSION_ONLY,
  scoped,
  UNRECORDED_MOUNT,
} from './route-scopes.js';

/**
 * The scope map, asserted against the live Express router stack rather than a
 * hand-kept path table matched on `req.path` — that would duplicate the router
 * and drift. These three tests are a security control, not a lint. Everything
 * not declared is denied to API key authentication at any scope, so a route
 * that slips through undeclared would default to reachable-by-any-key the
 * moment enforcement lands. If one of them starts failing, the fix is a
 * `scoped()` declaration on the new route, never an exclusion here.
 *
 * The expected list is the phase spec's scope table
 * (`spec-11.1-api-keys.md`, "Scopes") resolved to concrete routes. Adding a
 * route means adding a line, deliberately: a reviewer sees the scope a new
 * endpoint is reachable at in the diff.
 *
 * HEAD is absent by design. Express resolves a HEAD with no explicit handler
 * through the route's GET handler, so a GET declaration covers both.
 */
const EXPECTED_ROUTE_SCOPES = [
  'DELETE /api/v1/api-keys/:keyId → api-keys:manage',
  'DELETE /api/v1/auth/totp-enrollments/:id → session-only',
  'DELETE /api/v1/auth/totp-factor → session-only',
  'DELETE /api/v1/containers/:id → admin',
  'DELETE /api/v1/containers/:id/label-overrides → admin',
  'DELETE /api/v1/group-policies/:id → admin',
  'DELETE /api/v1/icons/cache → admin',
  'DELETE /api/v1/label-overrides/:overrideId → admin',
  'DELETE /api/v1/notifications/outbox/:id → triggers:test',
  'DELETE /api/v1/notifications/silences/:id → admin',
  'DELETE /api/v1/portwing/keys/:keyId → session-only',
  'GET /api/v1/actions → read',
  'GET /api/v1/actions/:type/:name → read',
  'GET /api/v1/actions/:type/:name/:agent → read',
  'GET /api/v1/actions/:type/:name/:agent/skips → read',
  'GET /api/v1/actions/:type/:name/skips → read',
  'GET /api/v1/agents → read',
  'GET /api/v1/agents/:name/key-rotation → session-only',
  'GET /api/v1/agents/:name/log/entries → read',
  'GET /api/v1/agents/roster → read',
  'GET /api/v1/api-keys → api-keys:manage',
  'GET /api/v1/app → read',
  'GET /api/v1/approvals → read',
  'GET /api/v1/approvals/:id → read',
  'GET /api/v1/approvals/summary → read',
  'GET /api/v1/audit → read',
  'GET /api/v1/audit/export → read',
  'GET /api/v1/auth/totp-factor → session-only',
  'GET /api/v1/authentications → read',
  'GET /api/v1/authentications/:type/:name → read',
  'GET /api/v1/authentications/:type/:name/:agent → read',
  'GET /api/v1/cleanup → read',
  'GET /api/v1/config → session-only',
  'GET /api/v1/config/:section → session-only',
  'GET /api/v1/config/editor/actions → session-only',
  'GET /api/v1/config/editor/triggers → session-only',
  'GET /api/v1/config/editor/watchers → session-only',
  'GET /api/v1/containers → read',
  'GET /api/v1/containers/:id → read',
  'GET /api/v1/containers/:id/backups → read',
  'GET /api/v1/containers/:id/effective-policy → read',
  'GET /api/v1/containers/:id/intermediate-release-notes → read',
  'GET /api/v1/containers/:id/label-overrides → read',
  'GET /api/v1/containers/:id/logs → read',
  'GET /api/v1/containers/:id/release-notes → read',
  'GET /api/v1/containers/:id/sbom → read',
  'GET /api/v1/containers/:id/stats → read',
  'GET /api/v1/containers/:id/stats/stream → read',
  'GET /api/v1/containers/:id/triggers → read',
  'GET /api/v1/containers/:id/update-operations → read',
  'GET /api/v1/containers/:id/vulnerabilities → read',
  'GET /api/v1/containers/backups → read',
  'GET /api/v1/containers/dependencies → read',
  'GET /api/v1/containers/groups → read',
  'GET /api/v1/containers/recent-status → read',
  'GET /api/v1/containers/security/vulnerabilities → read',
  'GET /api/v1/containers/stats → read',
  'GET /api/v1/containers/summary → read',
  'GET /api/v1/debug/dump → session-only',
  'GET /api/v1/events/ui → read',
  'GET /api/v1/group-policies → read',
  'GET /api/v1/group-policies/:id → read',
  'GET /api/v1/icons/:provider/:slug → read',
  'GET /api/v1/images → read',
  'GET /api/v1/images/prune-preview → admin',
  'GET /api/v1/label-overrides → read',
  'GET /api/v1/log → read',
  'GET /api/v1/log/components → read',
  'GET /api/v1/log/entries → read',
  'GET /api/v1/notification-triggers → read',
  'GET /api/v1/notification-triggers/:type/:name → read',
  'GET /api/v1/notification-triggers/:type/:name/:agent → read',
  'GET /api/v1/notification-triggers/:type/:name/:agent/skips → read',
  'GET /api/v1/notification-triggers/:type/:name/skips → read',
  'GET /api/v1/notifications → read',
  'GET /api/v1/notifications/outbox → read',
  'GET /api/v1/notifications/silences → read',
  'GET /api/v1/openapi.json → read',
  'GET /api/v1/portwing/keys → session-only',
  'GET /api/v1/preferences → read',
  'GET /api/v1/registries → read',
  'GET /api/v1/registries/:type/:name → read',
  'GET /api/v1/registries/:type/:name/:agent → read',
  'GET /api/v1/self-update/:operationId/status → session-only',
  'GET /api/v1/server → read',
  'GET /api/v1/server/security/runtime → read',
  'GET /api/v1/settings → read',
  'GET /api/v1/stats/summary → read',
  'GET /api/v1/stats/summary/stream → read',
  'GET /api/v1/store → read',
  'GET /api/v1/triggers → read',
  'GET /api/v1/triggers/:type/:name → read',
  'GET /api/v1/triggers/:type/:name/:agent → read',
  'GET /api/v1/triggers/:type/:name/:agent/skips → read',
  'GET /api/v1/triggers/:type/:name/skips → read',
  'GET /api/v1/update-operations/:id → read',
  'GET /api/v1/watchers → read',
  'GET /api/v1/watchers/:type/:name → read',
  'GET /api/v1/watchers/:type/:name/:agent → read',
  'GET /api/v1/{*path} → read',
  'PATCH /api/v1/config/editor/actions → admin',
  'PATCH /api/v1/config/editor/triggers → admin',
  'PATCH /api/v1/config/editor/watchers → admin',
  'PATCH /api/v1/containers/:id/label-overrides → admin',
  'PATCH /api/v1/containers/:id/update-policy → containers:update',
  'PATCH /api/v1/notifications/:id → admin',
  'PATCH /api/v1/preferences → admin',
  'PATCH /api/v1/settings → admin',
  'POST /api/v1/actions/:type/:name → dynamic',
  'POST /api/v1/actions/:type/:name/:agent → dynamic',
  'POST /api/v1/agents/:name/key-rotation → session-only',
  'POST /api/v1/api-keys → api-keys:manage',
  'POST /api/v1/approvals/:id/approve → containers:update',
  'POST /api/v1/approvals/:id/defer → containers:update',
  'POST /api/v1/approvals/:id/reject → containers:update',
  'POST /api/v1/approvals/bulk → containers:update',
  'POST /api/v1/auth/totp-enrollments → session-only',
  'POST /api/v1/auth/totp-recovery-code-sets → session-only',
  'POST /api/v1/cleanup/run → admin',
  'POST /api/v1/config/reload → admin',
  'POST /api/v1/config/validate → admin',
  'POST /api/v1/containers/:id/env/reveal → session-only',
  'POST /api/v1/containers/:id/preview → containers:watch',
  'POST /api/v1/containers/:id/restart → containers:control',
  'POST /api/v1/containers/:id/rollback → containers:update',
  'POST /api/v1/containers/:id/scan → containers:watch',
  'POST /api/v1/containers/:id/start → containers:control',
  'POST /api/v1/containers/:id/stop → containers:control',
  'POST /api/v1/containers/:id/triggers/:triggerType/:triggerName → dynamic',
  'POST /api/v1/containers/:id/triggers/:triggerType/:triggerName/:triggerAgent → dynamic',
  'POST /api/v1/containers/:id/update → containers:update',
  'POST /api/v1/containers/:id/update-chain-preview → containers:watch',
  'POST /api/v1/containers/:id/watch → containers:watch',
  'POST /api/v1/containers/scan-all → containers:watch',
  'POST /api/v1/containers/update → containers:update',
  'POST /api/v1/containers/watch → containers:watch',
  'POST /api/v1/dependency-groups/:rootId/update → containers:update',
  'POST /api/v1/events/ui/self-update/:operationId/ack → admin',
  'POST /api/v1/group-policies → admin',
  'POST /api/v1/images/prune → admin',
  'POST /api/v1/internal/self-update/finalize → session-only',
  'POST /api/v1/notification-triggers/:type/:name → dynamic',
  'POST /api/v1/notification-triggers/:type/:name/:agent → dynamic',
  'POST /api/v1/notifications/:id/preview → triggers:test',
  'POST /api/v1/notifications/outbox/:id/retry → triggers:test',
  'POST /api/v1/notifications/silences → admin',
  'POST /api/v1/operations/:id/cancel → containers:update',
  'POST /api/v1/portwing/keys → session-only',
  'POST /api/v1/server/security/assets/:provider/:operation → admin',
  'POST /api/v1/triggers/:type/:name → dynamic',
  'POST /api/v1/triggers/:type/:name/:agent → dynamic',
  'POST /api/v1/watchers/:type/:name/:agent/inventory → containers:watch',
  'POST /api/v1/watchers/:type/:name/inventory → containers:watch',
  'POST /api/v1/webhook/update/:containerName → session-only',
  'POST /api/v1/webhook/watch → session-only',
  'POST /api/v1/webhook/watch/:containerName → session-only',
  'POST /api/v1/webhooks/registry → session-only',
  'POST /api/v1/webhooks/registry/:provider → session-only',
  'POST /api/v1/webhooks/registry/:provider/:secret → session-only',
  'PUT /api/v1/auth/totp-enrollments/:id → session-only',
  'PUT /api/v1/config/:section → admin',
  'PUT /api/v1/group-policies/:id → admin',
  'PUT /api/v1/settings → admin',
];

// The router is built exactly once: several sub-routers register their routes
// on a module-scope router inside init(), so a second call would double every
// layer they own.
const mockGetExperimentalPortwingEnabled = vi.hoisted(() => vi.fn(() => true));
vi.mock('../configuration/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../configuration/index.js')>();
  return {
    ...actual,
    getExperimentalPortwingEnabled: mockGetExperimentalPortwingEnabled,
  };
});

describe('route scope completeness', () => {
  let declarations: RouteScopeDeclaration[];
  let apiRouter: { stack: { handle?: unknown; route?: { path: string } }[] };

  beforeAll(async () => {
    const api = await import('./api.js');
    apiRouter = api.init() as unknown as typeof apiRouter;
    declarations = collectRouteScopes(apiRouter, '/api/v1');
  });

  test('every route under /api/v1 declares the scope that reaches it', () => {
    expect(findUndeclaredRoutes(declarations).map(formatRouteScope)).toStrictEqual([]);
  });

  test('every session-only route declares the least role a person needs', () => {
    // A session-only route has no scope to derive a role floor from, so
    // leaving it out would hold every person to admin without anyone deciding
    // that. The floor goes on the scoped() call, never an exclusion here.
    expect(findUnflooredSessionOnlyRoutes(declarations).map(formatRouteScope)).toStrictEqual([]);
  });

  test('a session-only route registered without a floor fails the check', () => {
    const router = express.Router();
    router.get(
      '/floored',
      scoped(SESSION_ONLY, (_req, _res) => {}, { role: 'admin' }),
    );
    router.get(
      '/unfloored',
      scoped(SESSION_ONLY, (_req, _res) => {}),
    );

    expect(
      findUnflooredSessionOnlyRoutes(collectRouteScopes(router, '/api/v1')).map(formatRouteScope),
    ).toStrictEqual(['GET /api/v1/unfloored → session-only']);
  });

  test('every sub-router was mounted through mountRouter, so every path is real', () => {
    const unresolved = declarations
      .filter((declaration) => declaration.path.includes(UNRECORDED_MOUNT))
      .map(formatRouteScope);

    expect(unresolved).toStrictEqual([]);
  });

  test('the declared scopes match the phase spec table', () => {
    expect(declarations.map(formatRouteScope).sort()).toStrictEqual(EXPECTED_ROUTE_SCOPES);
  });

  test('only the routes that gate internally are declared dynamic', () => {
    // `dynamic` is the one declaration `enforceApiKeyScope` waves through as
    // route middleware, so each of these eight is a hole unless its handler
    // calls the helper itself. Enumerated separately from the table above so
    // adding a ninth is a deliberate line in a diff rather than a scope
    // silently loosening to nothing.
    const dynamic = declarations
      .filter((declaration) => declaration.scope === DYNAMIC_SCOPE)
      .map(formatRouteScope)
      .sort();

    expect(dynamic).toStrictEqual([
      'POST /api/v1/actions/:type/:name → dynamic',
      'POST /api/v1/actions/:type/:name/:agent → dynamic',
      'POST /api/v1/containers/:id/triggers/:triggerType/:triggerName → dynamic',
      'POST /api/v1/containers/:id/triggers/:triggerType/:triggerName/:triggerAgent → dynamic',
      'POST /api/v1/notification-triggers/:type/:name → dynamic',
      'POST /api/v1/notification-triggers/:type/:name/:agent → dynamic',
      'POST /api/v1/triggers/:type/:name → dynamic',
      'POST /api/v1/triggers/:type/:name/:agent → dynamic',
    ]);
  });

  test('a route registered without scoped() fails the completeness check', () => {
    const router = express.Router();
    router.get(
      '/declared',
      scoped('read', (_req, _res) => {}),
    );
    router.post('/added-without-a-scope', (_req, _res) => {});

    expect(
      findUndeclaredRoutes(collectRouteScopes(router, '/api/v1')).map(formatRouteScope),
    ).toStrictEqual(['POST /api/v1/added-without-a-scope → UNDECLARED']);
  });

  test('every protected router is mounted after requireAuthentication, public ones are listed', () => {
    const authIndex = apiRouter.stack.findIndex((layer) => layer.handle === requireAuthentication);
    expect(authIndex).toBeGreaterThan(-1);
    expect(apiRouter.stack.filter((layer) => layer.handle === requireAuthentication)).toHaveLength(
      1,
    );

    const mountPathOf = (layer: { handle?: unknown; route?: { path: string } }) =>
      layer.route
        ? `route:${layer.route.path}`
        : ((layer.handle as Record<symbol, unknown> | undefined)?.[
            Symbol.for('drydock.api.mountPath')
          ] as string | undefined);

    const before = apiRouter.stack.slice(0, authIndex).map(mountPathOf).filter(Boolean);
    expect([...before].sort()).toStrictEqual([
      '/internal',
      '/self-update',
      '/webhook',
      '/webhooks',
      'route:/openapi.json',
    ]);

    // Everything mounted after the auth line is a sub-router or the terminal 404.
    const after = apiRouter.stack
      .slice(authIndex + 1)
      .map(mountPathOf)
      .filter(Boolean);
    expect(after).toContain('/app');
    expect(after).toContain('/store');
    expect(after).toContain('/debug');
    expect(after).toContain('/containers');
    expect(after).toContain('/api-keys');
    expect(after).not.toContain('/webhook');
    expect(after).not.toContain('/internal');
  });
});
