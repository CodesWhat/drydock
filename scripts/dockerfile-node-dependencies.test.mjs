import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const appBuild = dockerfile.match(/^FROM base AS app-build\n([\s\S]*?)^FROM /m)?.[1];

test('backend build installs optional native compiler dependencies before compiling', () => {
  assert.ok(appBuild, 'backend build stage must exist');
  const install = appBuild.match(/^RUN npm ci (.*)$/m)?.[1];
  assert.ok(install, 'backend dependencies must use the committed lockfile');
  assert.match(install, /(?:^|\s)--include=dev(?:\s|$)/);
  assert.match(install, /(?:^|\s)--include=optional(?:\s|$)/);
  assert.doesNotMatch(install, /--omit=optional/);
  assert.ok(appBuild.indexOf('RUN npm ci') < appBuild.indexOf('RUN npm run build'));
});

test('backend runtime dependencies exclude development and optional packages after compiling', () => {
  assert.ok(appBuild, 'backend build stage must exist');
  assert.match(
    appBuild,
    /RUN npm run build \\\n\s+&& npm prune --omit=dev --omit=optional(?:\s|$)/,
  );
  assert.match(
    dockerfile,
    /^COPY --from=app-build \/home\/node\/app\/node_modules \.\/node_modules$/m,
  );
});
