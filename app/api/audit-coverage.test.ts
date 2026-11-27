import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every route that changes state (POST, PUT, PATCH, DELETE) has to write an
 * audit row or sit on the justified allowlist below. The route table is found
 * by scanning the API sources, so a new route fails this test until someone
 * decides which side of the line it is on.
 */

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Audited = { audit: Array<{ file: string; action: string }>; writer?: string };
type Exempt = { exempt: string };
type Classification = Audited | Exempt;

const at = (file: string, ...actions: string[]): Audited => ({
  audit: actions.map((action) => ({ file, action })),
});

const UPDATE_PIPELINE = at('event/audit-subscriptions.ts', 'update-applied', 'update-failed');

const ROUTES: Record<string, Classification> = {
  'api/agent.ts POST /:name/key-rotation': at('api/agent.ts', 'agent-key-changed'),
  'api/api-keys.ts POST /': at('api/api-key-audit.ts', 'api-key-created'),
  'api/api-keys.ts DELETE /:keyId': at('api/api-key-audit.ts', 'api-key-revoked'),
  'api/approvals.ts POST /bulk': at('api/approvals.ts', 'update-approved', 'update-rejected'),
  'api/approvals.ts POST /:id/approve': at('api/approvals.ts', 'update-approved'),
  'api/approvals.ts POST /:id/reject': at('api/approvals.ts', 'update-rejected'),
  'api/approvals.ts POST /:id/defer': at('api/approvals.ts', 'update-deferred'),
  'api/auth.ts POST /login': at('api/auth-audit.ts', 'auth-login'),
  'api/auth.ts PUT /login-challenges/:id': at('api/auth-audit.ts', 'auth-login'),
  'api/auth.ts DELETE /login-challenges/:id': {
    exempt:
      'Abandons a pending second-factor challenge before any session exists. Nothing changed.',
  },
  'api/auth.ts POST /remember': {
    exempt: 'Sets the remember-me cookie lifetime on the caller own session. No shared state.',
  },
  'api/auth.ts POST /api-key-review/acknowledge': {
    exempt: 'Clears a banner flag on the caller own session. No shared state.',
  },
  'api/auth.ts POST /logout': {
    exempt: 'Ends the caller own session. Logins are audited, session ends are not state changes.',
  },
  'api/backup.ts POST /:id/rollback': at('api/backup.ts', 'rollback'),
  'api/cleanup.ts POST /run': at('cleanup/run.ts', 'cleanup'),
  'api/config.ts PATCH /editor/watchers': at('api/config.ts', 'config-written'),
  'api/config.ts PATCH /editor/triggers': at('api/config.ts', 'config-written'),
  'api/config.ts PATCH /editor/actions': at('api/config.ts', 'config-written'),
  'api/config.ts POST /validate': at('api/config-validate.ts', 'config-validated'),
  'api/config.ts POST /reload': at('api/config.ts', 'config-reloaded'),
  'api/config.ts PUT /:section': at('api/config.ts', 'config-written'),
  'api/container-actions.ts POST /update': UPDATE_PIPELINE,
  'api/container-actions.ts POST /:id/start': at('api/container-actions.ts', 'container-start'),
  'api/container-actions.ts POST /:id/stop': at('api/container-actions.ts', 'container-stop'),
  'api/container-actions.ts POST /:id/restart': at('api/container-actions.ts', 'container-restart'),
  'api/container-actions.ts POST /:id/update': UPDATE_PIPELINE,
  'api/container-dependencies.ts POST /:id/update-chain-preview': {
    exempt: 'Read-only preview of an update chain. Nothing is written or dispatched.',
  },
  'api/container.ts POST /watch': {
    exempt:
      'Triggers a registry check. The resulting container and update events are audited by event/audit-subscriptions.',
  },
  'api/container.ts POST /scan-all': {
    exempt: 'Starts vulnerability scans. Scan outcomes and skips are audited by the scanner.',
  },
  'api/container.ts DELETE /:id': at('event/audit-subscriptions.ts', 'container-removed'),
  'api/container.ts POST /:id/triggers/:triggerType/:triggerName': {
    exempt:
      'Manual trigger fire. Update triggers go through the audited update pipeline and notification failures are audited by the trigger.',
  },
  'api/container.ts POST /:id/triggers/:triggerType/:triggerName/:triggerAgent': {
    exempt:
      'Manual trigger fire. Update triggers go through the audited update pipeline and notification failures are audited by the trigger.',
  },
  'api/container.ts PATCH /:id/update-policy': at(
    'api/container/update-policy.ts',
    'update-policy-override-set',
    'update-policy-override-cleared',
  ),
  'api/container.ts POST /:id/watch': {
    exempt:
      'Triggers a registry check for one container. The resulting events are audited by event/audit-subscriptions.',
  },
  'api/container.ts POST /:id/env/reveal': at('api/container/handlers/actions.ts', 'env-reveal'),
  'api/container.ts POST /:id/scan': {
    exempt: 'Starts a vulnerability scan. Scan outcomes and skips are audited by the scanner.',
  },
  'api/dependency-groups.ts POST /:rootId/update': UPDATE_PIPELINE,
  'api/group-policy.ts POST /': at('api/group-policy.ts', 'group-policy-set'),
  'api/group-policy.ts PUT /:id': at('api/group-policy.ts', 'group-policy-set'),
  'api/group-policy.ts DELETE /:id': at('api/group-policy.ts', 'group-policy-cleared'),
  'api/icons.ts DELETE /cache': {
    exempt: 'Drops the downloaded icon cache. Disposable data that refills on demand.',
  },
  'api/images.ts POST /prune': at('api/images.ts', 'image-prune'),
  'api/internal-self-update.ts POST /self-update/finalize': {
    exempt:
      'Internal handshake from the replacement container. The update that started it is audited by the update pipeline.',
  },
  'api/label-override.ts PATCH /:id/label-overrides': at(
    'api/label-override.ts',
    'label-override-set',
  ),
  'api/label-override.ts DELETE /:id/label-overrides': at(
    'api/label-override.ts',
    'label-override-cleared',
  ),
  'api/label-override.ts DELETE /:overrideId': at(
    'api/label-override.ts',
    'label-override-cleared',
  ),
  'api/notification-outbox.ts POST /:id/retry': at(
    'api/notification-outbox.ts',
    'notification-outbox-updated',
  ),
  'api/notification-outbox.ts DELETE /:id': at(
    'api/notification-outbox.ts',
    'notification-outbox-updated',
  ),
  'api/notification-silence.ts POST /': at(
    'api/notification-silence.ts',
    'notification-silence-set',
  ),
  'api/notification-silence.ts DELETE /:id': at(
    'api/notification-silence.ts',
    'notification-silence-cleared',
  ),
  'api/notification.ts PATCH /:id': at('api/notification.ts', 'notification-rule-updated'),
  'api/notification.ts POST /:id/preview': {
    exempt: 'Renders a template preview. Nothing is sent or stored.',
  },
  'api/operation.ts POST /:id/cancel': at('api/operation.ts', 'operation-cancelled'),
  'api/portwing.ts POST /keys': at('api/portwing.ts', 'agent-key-changed'),
  'api/portwing.ts DELETE /keys/:keyId': at('api/portwing.ts', 'agent-key-changed'),
  'api/preferences.ts PATCH /': {
    exempt: 'Per-user UI preferences synced for the caller. Not operational or security state.',
  },
  'api/preview.ts POST /:id/preview': at('api/preview.ts', 'preview'),
  'api/server.ts POST /security/assets/:provider/:operation': {
    ...at('security/assets.ts', 'scanner-asset-pull-started', 'scanner-asset-warm-started'),
    writer: 'security/scanner-runtime.ts',
  },
  'api/settings.ts PATCH /': at('api/settings.ts', 'settings-updated'),
  'api/settings.ts PUT /': at('api/settings.ts', 'settings-updated'),
  'api/sse.ts POST /self-update/:operationId/ack': {
    exempt:
      'Browser acknowledgement that it saw a self-update notice. Resolves an in-memory wait only.',
  },
  'api/totp-factor.ts DELETE /totp-factor': at('api/totp-factor.ts', 'totp-disabled'),
  'api/totp-factor.ts POST /totp-enrollments': at('api/totp-factor.ts', 'totp-enrollment-started'),
  'api/totp-factor.ts PUT /totp-enrollments/:id': at('api/totp-factor.ts', 'totp-enabled'),
  'api/totp-factor.ts DELETE /totp-enrollments/:id': {
    exempt: 'Cancels a pending enrollment that never became active. Starting one is audited.',
  },
  'api/totp-factor.ts POST /totp-recovery-code-sets': at(
    'api/totp-factor.ts',
    'totp-recovery-codes-replaced',
  ),
  'api/trigger-routes.ts POST /:type/:name': {
    exempt:
      'Manual trigger fire. Update triggers go through the audited update pipeline and notification failures are audited by the trigger.',
  },
  'api/trigger-routes.ts POST /:type/:name/:agent': {
    exempt:
      'Manual trigger fire. Update triggers go through the audited update pipeline and notification failures are audited by the trigger.',
  },
  'api/trigger.ts POST /:type/:name': {
    exempt:
      'Manual trigger fire. Update triggers go through the audited update pipeline and notification failures are audited by the trigger.',
  },
  'api/trigger.ts POST /:type/:name/:agent': {
    exempt:
      'Manual trigger fire. Update triggers go through the audited update pipeline and notification failures are audited by the trigger.',
  },
  'api/watcher.ts POST /:type/:name/inventory': {
    exempt: 'Re-reads the container inventory from the host. Changes in it are audited as events.',
  },
  'api/watcher.ts POST /:type/:name/:agent/inventory': {
    exempt: 'Re-reads the container inventory from the host. Changes in it are audited as events.',
  },
  'api/webhook.ts POST /watch': at('api/webhook.ts', 'webhook-watch'),
  'api/webhook.ts POST /watch/:containerName': at('api/webhook.ts', 'webhook-watch-container'),
  'api/webhook.ts POST /update/:containerName': at('api/webhook.ts', 'webhook-update'),
  'api/webhooks/registry.ts POST /': {
    exempt:
      'Inbound registry notification that only schedules a registry check. Resulting events are audited.',
  },
  'api/webhooks/registry.ts POST /:provider': {
    exempt:
      'Inbound registry notification that only schedules a registry check. Resulting events are audited.',
  },
  'api/webhooks/registry.ts POST /:provider/:secret': {
    exempt:
      'Inbound registry notification that only schedules a registry check. Resulting events are audited.',
  },
};

const ROUTE_PATTERN =
  /\b(\w*(?:router|Router|app))\.(post|put|patch|delete)\(\s*(['"`])([^'"`]*)\3/g;

function listSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSources(full);
    }
    const isSource =
      entry.name.endsWith('.ts') &&
      !/\.(test|typecheck|test\.helpers)\.ts$|\.d\.ts$/.test(entry.name);
    return isSource ? [full] : [];
  });
}

function discoverRoutes(): string[] {
  const found: string[] = [];
  for (const file of listSources(path.join(appRoot, 'api'))) {
    const source = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const relative = path.relative(appRoot, file).split(path.sep).join('/');
    for (const match of source.matchAll(ROUTE_PATTERN)) {
      found.push(`${relative} ${match[2].toUpperCase()} ${match[4]}`);
    }
  }
  return found.sort();
}

const auditActions = new Set(
  [
    ...fs
      .readFileSync(path.join(appRoot, 'model/audit.d.ts'), 'utf8')
      .matchAll(/\|\s*'([a-z-]+)'/g),
  ].map((match) => match[1]),
);

describe('state-changing API routes and the audit log', () => {
  const discovered = discoverRoutes();

  test('finds the route table', () => {
    expect(discovered.length).toBeGreaterThan(60);
  });

  test('every POST/PUT/PATCH/DELETE route is classified, and nothing stale is listed', () => {
    const classified = Object.keys(ROUTES).sort();
    expect(
      discovered.filter((route) => !(route in ROUTES)),
      'new route with no audit decision; add it to ROUTES',
    ).toEqual([]);
    expect(
      classified.filter((route) => !discovered.includes(route)),
      'ROUTES lists a route that no longer exists',
    ).toEqual([]);
  });

  test.each(Object.entries(ROUTES).filter(([, c]) => 'audit' in c))(
    '%s writes an audit row',
    (_route, classification) => {
      for (const { file, action } of (classification as Audited).audit) {
        expect(auditActions.has(action), `${action} is not an AuditEntry action`).toBe(true);
        const source = fs.readFileSync(path.join(appRoot, file), 'utf8');
        expect(source, `${file} never writes '${action}'`).toContain(`'${action}'`);
        const writerFile = (classification as Audited).writer ?? file;
        expect(
          fs.readFileSync(path.join(appRoot, writerFile), 'utf8'),
          `${writerFile} has no audit writer`,
        ).toMatch(
          /recordAuditEvent|insertAudit|audit\(|recordAudit|recordLoginAuditEvent|recordApiKey/,
        );
      }
    },
  );

  test.each(Object.entries(ROUTES).filter(([, c]) => 'exempt' in c))(
    '%s has a written justification for skipping the audit log',
    (_route, classification) => {
      expect((classification as Exempt).exempt.trim().length).toBeGreaterThan(30);
    },
  );
});
