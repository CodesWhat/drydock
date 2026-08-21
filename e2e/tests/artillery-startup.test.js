const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

// The Artillery load-test jobs only run on main pushes and
// workflow_dispatch, never on PRs, so a dependency change that breaks
// Artillery at module load merges green and detonates after the fact
// (js-yaml v5 override, main push run 32444352693). This runs on every
// PR via test:support: parse the real CI scenario and execute one VU
// against a dead target, which exercises Artillery's full startup path
// including its YAML loader. ECONNREFUSED is the expected outcome; a
// loader crash never reaches the phase log.
test('artillery starts up and parses the ci load-test scenario', () => {
  const scenario = join(__dirname, '../../test/test.yml');
  const artillery = join(__dirname, '../node_modules/.bin/artillery');
  const overrides = JSON.stringify({
    config: { phases: [{ duration: 1, arrivalCount: 1 }] },
  });

  let output;
  try {
    output = execFileSync(
      artillery,
      ['run', scenario, '-e', 'ci', '--target', 'http://127.0.0.1:9', '--overrides', overrides],
      { encoding: 'utf8', timeout: 120_000 },
    );
  } catch (error) {
    // Artillery exits non-zero when VUs fail; the startup path still ran.
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  assert.doesNotMatch(output, /SyntaxError|Cannot find module|ERR_MODULE_NOT_FOUND/);
  assert.match(output, /Phase started/);
});
