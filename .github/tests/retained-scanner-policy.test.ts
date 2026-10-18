import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

const repository = fileURLToPath(new URL('../..', import.meta.url));

test('retained configuration restoration overwrites PR edits with reviewed bytes', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'drydock-retained-policy-'));
  const env = { ...process.env };
  const localNames = execFileSync('git', ['rev-parse', '--local-env-vars'], {
    encoding: 'utf8',
  });
  for (const name of [...localNames.trim().split('\n'), 'GIT_CEILING_DIRECTORIES']) {
    delete env[name];
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: fixture, env, encoding: 'utf8', stdio: 'pipe' });
  try {
    git('init', '--initial-branch=fixture');
    git('remote', 'add', 'origin', repository);
    for (const path of ['.gitleaks.toml']) {
      writeFileSync(join(fixture, path), 'unreviewed PR configuration\n');
    }
    writeFileSync(join(fixture, '.gitleaksignore'), 'retained fixture baseline\n');
    const step = loadWorkflow(
      join(repository, '.github/workflows/ci-verify.yml'),
    ).jobs?.secrets?.steps?.find(
      (candidate) => candidate.name === 'Restore reviewed retained-line scanner configuration',
    );
    expect(step?.run).toBeTruthy();
    execFileSync('bash', ['-euo', 'pipefail', '-c', step?.run ?? 'exit 1'], {
      cwd: fixture,
      env: { ...env, ...step?.env },
      stdio: 'pipe',
    });
    expect(readFileSync(join(fixture, '.gitleaksignore'), 'utf8')).toBe(
      'retained fixture baseline\n',
    );
    for (const path of ['.gitleaks.toml']) {
      const reviewed = git('show', `${step?.env?.SCANNER_CONFIG_COMMIT}:${path}`);
      expect(readFileSync(join(fixture, path), 'utf8')).toBe(reviewed);
      expect(readFileSync(join(repository, path), 'utf8')).toBe(reviewed);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
