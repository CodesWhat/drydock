import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

test('runtime image pins the available Alpine jq release', () => {
  assert.match(dockerfile, /^\s+jq=1\.8\.2-r0 \\$/m);
});
