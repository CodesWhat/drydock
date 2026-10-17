import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

const workflowPath = fileURLToPath(new URL('../workflows/ci-verify.yml', import.meta.url));
const policyFiles = ['scripts/scan-secrets.sh', '.gitleaks.toml', '.gitleaksignore'];
const repositoryEnvNames = [
  ...execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' })
    .trim()
    .split('\n'),
  'GIT_CEILING_DIRECTORIES',
];

function gitEnv() {
  const env = { ...process.env };
  // Hooks export repository paths that override cwd. Every fixture subprocess
  // must discard them before it can initialize or operate on a temporary repo.
  for (const name of repositoryEnvNames) delete env[name];
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Release Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.test',
    GIT_COMMITTER_NAME: 'Release Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.test',
  };
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, env: gitEnv(), encoding: 'utf8', stdio: 'pipe' }).trim();
}

function writePolicy(cwd: string, label: string) {
  mkdirSync(join(cwd, 'scripts'), { recursive: true });
  writeFileSync(join(cwd, 'scripts/scan-secrets.sh'), `#!/bin/sh\n# ${label}\n`);
  writeFileSync(join(cwd, '.gitleaks.toml'), `title = "${label}"\n`);
  writeFileSync(join(cwd, '.gitleaksignore'), `# ${label}\n`);
}

function commit(cwd: string, subject: string) {
  git(cwd, 'add', '.');
  git(cwd, 'commit', '--allow-empty', '-m', `test(fixtures): ${subject}`);
}

function withRepository(
  run: (fixture: { seed: string; work: string }) => void,
  developmentPatch = '0',
) {
  const root = mkdtempSync(join(tmpdir(), 'drydock-policy-'));
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  const work = join(root, 'work');
  try {
    git(root, 'init', '--bare', '--initial-branch=main', remote);
    git(root, 'init', '--initial-branch=main', seed);
    git(seed, 'remote', 'add', 'origin', remote);
    writeFileSync(join(seed, '.gitignore'), '.claude/\n.planning/\n');
    writeFileSync(join(seed, 'package.json'), JSON.stringify({ version: '1.7.0' }));
    writePolicy(seed, 'main');
    commit(seed, 'main policy');
    git(seed, 'tag', 'v1.7.0-rc.24');
    git(seed, 'switch', '-c', 'dev/v1.8');
    writeFileSync(
      join(seed, 'package.json'),
      JSON.stringify({ version: ['1', '8', developmentPatch].join('.') }),
    );
    writePolicy(seed, 'development');
    commit(seed, 'reviewed development policy');
    git(seed, 'push', 'origin', 'main', 'dev/v1.8', '--tags');
    git(root, 'clone', '--quiet', '--no-hardlinks', remote, work);
    git(work, 'switch', '-c', 'promotion', 'origin/dev/v1.8');
    run({ seed, work });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function restorePolicy(work: string, base: string) {
  const step = loadWorkflow(workflowPath).jobs?.secrets?.steps?.find((candidate) =>
    candidate.name?.startsWith('Restore scanner policy'),
  );
  expect(step?.run).toBeTruthy();
  execFileSync('bash', ['-euo', 'pipefail', '-c', step?.run ?? 'exit 1'], {
    cwd: work,
    env: { ...gitEnv(), BASE_REF: base },
    stdio: 'pipe',
  });
}

function expectPolicy(work: string, label: string) {
  for (const path of policyFiles) {
    expect(readFileSync(join(work, path), 'utf8')).toContain(label);
  }
}

test('Git fixtures stay isolated under inherited hook repository paths', () => {
  withRepository(({ work }) => {
    const head = git(work, 'rev-parse', 'HEAD');
    const origin = git(work, 'remote', 'get-url', 'origin');
    const gitDir = git(work, 'rev-parse', '--absolute-git-dir');
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url)),
        'run',
        fileURLToPath(import.meta.url),
        '--config',
        fileURLToPath(new URL('./vitest.config.mjs', import.meta.url)),
        '--maxWorkers=1',
        '--fileParallelism=false',
        '--testNamePattern',
        '^an exact dev-tree promotion restores the already reviewed development policy$',
        '--reporter=json',
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          ...gitEnv(),
          GIT_DIR: gitDir,
          GIT_COMMON_DIR: gitDir,
          GIT_WORK_TREE: work,
          GIT_INDEX_FILE: join(gitDir, 'index'),
        },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, (result.stderr + result.stdout).slice(-3000)).toBe(0);
    const child = JSON.parse(result.stdout);
    expect(child.success).toBe(true);
    expect(child.numPassedTests).toBe(1);
    expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(work, 'rev-parse', '--is-bare-repository')).toBe('false');
    expect(git(work, 'remote', 'get-url', 'origin')).toBe(origin);
    expect(git(work, 'status', '--porcelain=v1')).toBe('');
  });
}, 30_000);

test('an exact dev-tree promotion restores the already reviewed development policy', () => {
  withRepository(({ work }) => {
    commit(work, 'promotion metadata');
    expect(git(work, 'rev-parse', 'HEAD')).not.toBe(git(work, 'rev-parse', 'origin/dev/v1.8'));
    writePolicy(work, 'unreviewed working copy');

    restorePolicy(work, 'main');

    expectPolicy(work, 'development');
  });
});

test.each([
  ['0.99.99', 'development'],
  ['1.7.99', 'development'],
  ['1.8.0', 'development'],
  ['1.8.1', 'main'],
  ['1.9.0', 'main'],
  ['1.10.0', 'main'],
  ['2.0.0', 'main'],
])('an exact promotion against main %s selects %s policy', (version, policy) => {
  withRepository(({ seed, work }) => {
    git(seed, 'switch', 'main');
    writeFileSync(join(seed, 'package.json'), JSON.stringify({ version }));
    commit(seed, 'advance main release base');
    git(seed, 'push', 'origin', 'main');

    restorePolicy(work, 'main');

    expectPolicy(work, policy);
  });
});

test.each([
  ['9007199254740992', '9007199254740993', 'main'],
  ['9007199254740993', '9007199254740992', 'development'],
])('large patch components %s against %s select %s policy', (candidatePatch, mainPatch, policy) => {
  withRepository(({ seed, work }) => {
    git(seed, 'switch', 'main');
    writeFileSync(
      join(seed, 'package.json'),
      JSON.stringify({ version: ['1', '8', mainPatch].join('.') }),
    );
    commit(seed, 'advance main large release base');
    git(seed, 'push', 'origin', 'main');

    restorePolicy(work, 'main');

    expectPolicy(work, policy);
  }, candidatePatch);
});

test('a main PR with unreviewed application changes keeps the main policy', () => {
  withRepository(({ work }) => {
    writeFileSync(join(work, 'application.txt'), 'unreviewed application change\n');
    commit(work, 'unreviewed application');

    restorePolicy(work, 'main');

    expectPolicy(work, 'main');
  });
});

test('a main PR cannot select development policy after changing its own scanner policy', () => {
  withRepository(({ work }) => {
    writePolicy(work, 'unreviewed policy');
    commit(work, 'unreviewed scanner policy');

    restorePolicy(work, 'main');

    expectPolicy(work, 'main');
  });
});

test('ordinary dev PRs restore their base policy despite unreviewed policy edits', () => {
  withRepository(({ work }) => {
    writePolicy(work, 'unreviewed policy');
    writeFileSync(join(work, 'application.txt'), 'unreviewed application change\n');
    commit(work, 'feature changes');

    restorePolicy(work, 'dev/v1.8');

    expectPolicy(work, 'development');
    expect(readFileSync(join(work, 'application.txt'), 'utf8')).toContain('unreviewed');
  });
});

test('a failed development-ref fetch cannot select a stale local policy ref', () => {
  withRepository(({ seed, work }) => {
    git(seed, 'push', 'origin', '--delete', 'dev/v1.8');
    expect(git(work, 'rev-parse', 'origin/dev/v1.8')).toBeTruthy();

    restorePolicy(work, 'main');

    expectPolicy(work, 'main');
  });
});

test('an unavailable base policy fails the job before it can scan with PR policy', () => {
  withRepository(({ work }) => {
    writePolicy(work, 'unreviewed policy');

    expect(() => restorePolicy(work, 'missing-base')).toThrow();
  });
});

test('policy restoration preserves complete history and retained release tags', () => {
  withRepository(({ work }) => {
    const before = git(work, 'rev-list', '--all', '--count');
    const tag = git(work, 'rev-parse', 'v1.7.0-rc.24');

    restorePolicy(work, 'main');

    expect(git(work, 'rev-parse', '--is-shallow-repository')).toBe('false');
    expect(git(work, 'rev-list', '--all', '--count')).toBe(before);
    expect(git(work, 'rev-parse', 'v1.7.0-rc.24')).toBe(tag);
  });
});
