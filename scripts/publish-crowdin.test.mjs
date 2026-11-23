import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const publisher = resolve('scripts/publish-crowdin.sh');
const gitEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};
const runGit = (args, options = {}) => execFileSync('git', args, { ...options, env: gitEnv });

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'drydock-crowdin-'));
  const remote = join(root, 'origin.git');
  const checkout = join(root, 'checkout');
  const bin = join(root, 'bin');
  const git = (...args) =>
    runGit(args, {
      cwd: checkout,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    mkdirSync(checkout);
    mkdirSync(bin);
    runGit(['init', '--bare', remote], { stdio: 'ignore' });
    git('init', '-b', 'dev/v1.9');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.com');
    git('remote', 'add', 'origin', remote);
    mkdirSync(join(checkout, 'ui/src/locales/de'), { recursive: true });
    const locale = join(checkout, 'ui/src/locales/de/messages.json');
    writeFileSync(locale, '{"message":"original"}\n');
    git('add', '.');
    git('commit', '-m', 'test: seed locale');
    git('push', '-u', 'origin', 'dev/v1.9');
    const integration = git('rev-parse', 'HEAD');
    writeFileSync(
      join(bin, 'gh'),
      '#!/usr/bin/env bash\nset -eu\nprintf "%s\\n" "$*" >> "$GH_CALLS"\nif [ "$1 $2 $3 $4" = "api --method POST repos/CodesWhat/drydock/pulls" ]; then echo 9999; fi\nif [ "$1 $2 $3 $4" = "api --method GET repos/CodesWhat/drydock/pulls" ]; then printf "%s" "${GH_EXISTING_PR:-}"; fi\n',
      { mode: 0o755 },
    );
    const publish = (options = {}) =>
      spawnSync('bash', [publisher], {
        cwd: checkout,
        encoding: 'utf8',
        env: {
          ...gitEnv,
          PATH: `${bin}:${process.env.PATH}`,
          BASE_BRANCH: 'dev/v1.9',
          GH_REPO: 'CodesWhat/drydock',
          GH_CALLS: join(root, 'gh-calls'),
          GH_EXISTING_PR: options.existingPr ?? '',
        },
      });
    run({ git, checkout, remote, locale, integration, publish, root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('publishes new translations without advancing the integration branch', () => {
  fixture(({ git, locale, remote, integration, publish, root }) => {
    writeFileSync(locale, '{"message":"translated"}\n');
    const result = publish();
    assert.equal(result.status, 0, result.stderr);
    const remoteGit = (...args) =>
      runGit(['--git-dir', remote, ...args], { encoding: 'utf8' }).trim();
    assert.equal(remoteGit('rev-parse', 'dev/v1.9'), integration);
    assert.equal(
      remoteGit('show', 'l10n_crowdin:ui/src/locales/de/messages.json'),
      '{"message":"translated"}',
    );
    assert.ok(git('rev-list', 'HEAD').split('\n').includes(integration));
    const calls = readFileSync(join(root, 'gh-calls'), 'utf8');
    assert.match(calls, /api --method POST repos\/CodesWhat\/drydock\/pulls -f base=dev\/v1\.9/);
    assert.match(calls, /head=CodesWhat:l10n_crowdin/);
  });
});

test('retains existing localization commits and updates their existing PR', () => {
  fixture(({ git, checkout, locale, publish, root }) => {
    git('switch', '-c', 'l10n_crowdin');
    writeFileSync(join(checkout, 'ui/src/locales/de/retained.json'), '{"retained":true}\n');
    git('add', '.');
    git('commit', '-m', 'test: preserve pending translation');
    git('push', 'origin', 'l10n_crowdin');
    const previous = git('rev-parse', 'HEAD');
    git('switch', 'dev/v1.9');
    git('branch', '-D', 'l10n_crowdin');
    writeFileSync(locale, '{"message":"translated"}\n');
    const result = publish({ existingPr: '42' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(git('rev-list', 'HEAD').split('\n').includes(previous));
    assert.equal(
      readFileSync(join(checkout, 'ui/src/locales/de/retained.json'), 'utf8'),
      '{"retained":true}\n',
    );
    const calls = readFileSync(join(root, 'gh-calls'), 'utf8');
    assert.match(
      calls,
      /api --method PATCH repos\/CodesWhat\/drydock\/pulls\/42 -f base=dev\/v1\.9/,
    );
    assert.doesNotMatch(calls, /api --method POST repos\/CodesWhat\/drydock\/pulls /);
  });
});

test('an identical pending translation tree does not create another CI push', () => {
  fixture(({ git, locale, remote, publish }) => {
    git('switch', '-c', 'l10n_crowdin');
    writeFileSync(locale, '{"message":"translated"}\n');
    git('add', '.');
    git('commit', '-m', 'test: seed pending translation');
    git('push', 'origin', 'l10n_crowdin');
    const previous = git('rev-parse', 'HEAD');
    git('switch', 'dev/v1.9');
    git('branch', '-D', 'l10n_crowdin');
    writeFileSync(locale, '{"message":"translated"}\n');
    const result = publish({ existingPr: '42' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Localization branch content unchanged/);
    assert.equal(
      runGit(['--git-dir', remote, 'rev-parse', 'l10n_crowdin'], {
        encoding: 'utf8',
      }).trim(),
      previous,
    );
  });
});

test('conflicting downloaded edits fail without replacing the remote branch', () => {
  fixture(({ git, locale, remote, publish }) => {
    git('switch', '-c', 'l10n_crowdin');
    writeFileSync(locale, '{"message":"pending remote edit"}\n');
    git('add', '.');
    git('commit', '-m', 'test: preserve conflicting translation');
    git('push', 'origin', 'l10n_crowdin');
    const previous = git('rev-parse', 'HEAD');
    git('switch', 'dev/v1.9');
    git('branch', '-D', 'l10n_crowdin');
    writeFileSync(locale, '{"message":"conflicting download"}\n');
    const result = publish();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /CONFLICT/);
    assert.equal(
      runGit(['--git-dir', remote, 'rev-parse', 'l10n_crowdin'], {
        encoding: 'utf8',
      }).trim(),
      previous,
    );
  });
});

test('an unchanged download does not publish a branch or open a PR', () => {
  fixture(({ git, publish }) => {
    const result = publish();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No translation changes/);
    assert.equal(git('ls-remote', '--heads', 'origin', 'refs/heads/l10n_crowdin'), '');
  });
});

test('Git fixtures ignore repository settings inherited from hooks', () => {
  const root = mkdtempSync(join(tmpdir(), 'drydock-crowdin-parent-'));
  try {
    const parent = join(root, 'parent.git');
    runGit(['init', '--bare', parent], { stdio: 'ignore' });
    const before = readFileSync(join(parent, 'config'));
    const result = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-reporter=tap',
        '--test-name-pattern',
        '^publishes new translations',
        resolve(import.meta.filename),
      ],
      {
        encoding: 'utf8',
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([name]) => name !== 'NODE_TEST_CONTEXT'),
          ),
          GIT_DIR: parent,
          GIT_COMMON_DIR: parent,
          GIT_WORK_TREE: root,
          GIT_INDEX_FILE: join(root, 'parent-index'),
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'user.name',
          GIT_CONFIG_VALUE_0: 'Inherited hook identity',
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /ok \d+ - publishes new translations/);
    assert.match(result.stdout, /# pass 1\b/);
    assert.deepEqual(readFileSync(join(parent, 'config')), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
