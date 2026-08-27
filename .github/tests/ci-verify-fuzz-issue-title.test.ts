import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkflow } from './workflow-test-utils';

// The fuzz job's unattended-failure notifier both WRITES an issue title and
// MATCHES on it to decide between commenting and filing a new issue. Renaming
// that title is therefore not a free rename: an issue an earlier run filed
// under the old title stops matching, stays open, and gets a duplicate filed
// beside it every subsequent failure.
//
// These tests execute the real `run:` block against a stubbed `curl` so the
// migration path can't drift from what ships. They assert on the requests the
// step would actually issue, not on the YAML text.
const workflowPath = fileURLToPath(new URL('../workflows/ci-verify.yml', import.meta.url));

const NEW_TITLE = 'CI: Fuzz tests failing on main';
const LEGACY_TITLE = '🚨 CI: Fuzz tests failing on main';

function loadNotifyStep(): { run: string; env: Record<string, string> } {
  const workflow = loadWorkflow(workflowPath);
  const step = workflow.jobs?.fuzz?.steps?.find(
    (candidate) => candidate.name === 'Notify via issue on unattended failure',
  );

  if (!step?.run || !step.env) {
    throw new Error(
      "Expected ci-verify.yml's fuzz job to include a step named " +
        "'Notify via issue on unattended failure' with a run block and env",
    );
  }

  return { run: step.run, env: step.env };
}

interface Request {
  method: string;
  url: string;
  body: string;
}

// Runs the step with `curl` stubbed. The stub logs every invocation and
// answers the issue-list GET with `openIssues`; everything else gets an empty
// object, which is all the step does with those responses.
function runNotifyStep(openIssues: unknown[]): { status: number; requests: Request[] } {
  const workdir = mkdtempSync(join(tmpdir(), 'ci-verify-fuzz-issue-title-'));
  try {
    const requestLog = join(workdir, 'requests.jsonl');
    const issuesJson = join(workdir, 'issues.json');
    writeFileSync(issuesJson, JSON.stringify(openIssues));

    const curlStub = join(workdir, 'curl');
    writeFileSync(
      curlStub,
      `#!/usr/bin/env bash
method=GET
url=
body=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -d) body="$2"; shift 2 ;;
    -H) shift 2 ;;
    -fsSL) shift ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
jq -n -c --arg m "$method" --arg u "$url" --arg b "$body" \\
  '{method: $m, url: $u, body: $b}' >> '${requestLog}'
if [ "$method" = "GET" ]; then
  cat '${issuesJson}'
else
  echo '{}'
fi
`,
    );
    chmodSync(curlStub, 0o755);

    const { run, env: stepEnv } = loadNotifyStep();
    const scriptPath = join(workdir, 'notify.sh');
    writeFileSync(scriptPath, run);

    const env: NodeJS.ProcessEnv = {
      PATH: `${workdir}:${process.env.PATH ?? ''}`,
      GH_TOKEN: 'stub',
      ISSUE_TITLE: stepEnv.ISSUE_TITLE,
      LEGACY_ISSUE_TITLE: stepEnv.LEGACY_ISSUE_TITLE,
      RUN_URL: 'https://github.com/CodesWhat/drydock/actions/runs/1',
      GITHUB_API_URL: 'https://api.github.com',
      GITHUB_REPOSITORY: 'CodesWhat/drydock',
      GITHUB_SHA: 'deadbeef',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ID: '1',
      GITHUB_RUN_ATTEMPT: '1',
    };

    let status = 0;
    try {
      execFileSync('bash', [scriptPath], { cwd: workdir, env, encoding: 'utf8' });
    } catch (error) {
      status = (error as { status?: number }).status ?? 1;
    }

    let requests: Request[] = [];
    try {
      requests = readFileSync(requestLog, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Request);
    } catch {
      requests = [];
    }

    return { status, requests };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

test('the step writes the emoji-free title and still recognises the legacy one', () => {
  const { env } = loadNotifyStep();

  expect(env.ISSUE_TITLE).toBe(NEW_TITLE);
  expect(env.LEGACY_ISSUE_TITLE).toBe(LEGACY_TITLE);
});

test('an open issue under the LEGACY title is retitled, then commented on', () => {
  // The migration case. Before this handling existed, the legacy issue simply
  // didn't match and the step filed a duplicate.
  const { status, requests } = runNotifyStep([{ number: 42, title: LEGACY_TITLE }]);

  expect(status).toBe(0);

  const patches = requests.filter((r) => r.method === 'PATCH');
  expect(patches).toHaveLength(1);
  expect(patches[0].url).toBe('https://api.github.com/repos/CodesWhat/drydock/issues/42');
  expect(JSON.parse(patches[0].body)).toStrictEqual({ title: NEW_TITLE });

  const posts = requests.filter((r) => r.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0].url).toBe('https://api.github.com/repos/CodesWhat/drydock/issues/42/comments');

  // Critically: no new issue was filed.
  expect(posts.some((r) => r.url.endsWith('/issues'))).toBe(false);
});

test('an open issue under the NEW title is commented on without a retitle', () => {
  const { status, requests } = runNotifyStep([{ number: 7, title: NEW_TITLE }]);

  expect(status).toBe(0);
  // The migration branch must stop firing once the title has been migrated,
  // or every subsequent failure issues a redundant PATCH.
  expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);

  const posts = requests.filter((r) => r.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0].url).toBe('https://api.github.com/repos/CodesWhat/drydock/issues/7/comments');
});

test('with no matching issue open, a new one is filed under the new title', () => {
  const { status, requests } = runNotifyStep([
    { number: 1, title: 'Something unrelated' },
    // A pull request comes back from the issues endpoint too, and must never
    // be mistaken for the tracking issue.
    { number: 2, title: NEW_TITLE, pull_request: { url: 'https://example.invalid' } },
  ]);

  expect(status).toBe(0);
  expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);

  const posts = requests.filter((r) => r.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0].url).toBe('https://api.github.com/repos/CodesWhat/drydock/issues');
  expect(JSON.parse(posts[0].body).title).toBe(NEW_TITLE);
});
