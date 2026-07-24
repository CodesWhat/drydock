import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Cucumber leaves browser navigation to the release-gated Playwright suite', async () => {
  const [cucumberUiFeature, navigationSpec, healthSpec, loginSpec, packageSource] =
    await Promise.all([
      repositoryFile('e2e/features/ui.feature'),
      repositoryFile('e2e/playwright/navigation.spec.ts'),
      repositoryFile('e2e/playwright/v16-health-preferences.spec.ts'),
      repositoryFile('e2e/playwright/login.spec.ts'),
      repositoryFile('e2e/package.json'),
    ]);

  assert.doesNotMatch(cucumberUiFeature, /I open UI route|I am signed into the UI/u);
  assert.match(cucumberUiFeature, /Drydock must serve the ui/u);
  assert.match(cucumberUiFeature, /redirect to the ui if resource not found/u);

  for (const [path, routeName] of [
    ['/', 'dashboard'],
    ['/containers', 'containers'],
    ['/containers/missing-container/logs', 'container-logs'],
    ['/security', 'security'],
    ['/servers', 'servers'],
    ['/config', 'config'],
    ['/registries', 'registries'],
    ['/agents', 'agents'],
    ['/triggers', 'triggers'],
    ['/watchers', 'watchers'],
    ['/auth', 'auth'],
    ['/notifications', 'notifications'],
    ['/notifications/outbox', 'notification-outbox'],
    ['/audit', 'audit'],
    ['/logs', 'logs'],
  ]) {
    assert.ok(
      navigationSpec.includes(`{ path: '${path}', routeName: '${routeName}' }`),
      `Playwright must keep ${path} paired with the ${routeName} route landmark`,
    );
  }
  assert.match(navigationSpec, /main\[data-route-name=/u);
  assert.match(navigationSpec, /locator\(':scope > \*'\)\.first\(\)/u);
  assert.match(
    healthSpec,
    /request\.post\(`\/api\/v1\/containers\/\$\{encodeURIComponent\(fixtureId\)\}\/watch`/u,
  );
  assert.match(loginSpec, /login redirects to dashboard/u);

  const packageJson = JSON.parse(packageSource);
  assert.match(packageJson.scripts['test:support'], /tests\/\*\.test\.js/u);
  assert.match(packageJson.scripts['test:support'], /tests\/security\/\*\.test\.js/u);
});
