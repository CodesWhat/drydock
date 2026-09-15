import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The webhooks doc's curl examples authenticate with the literal placeholder
// "your-token-here", which the default gitleaks curl-auth-header rule flags
// on every line it appears. .gitleaksignore used to carry one line-pinned
// fingerprint per occurrence, and a docs edit that shifts those lines (as
// happened to webhooks/index.mdx on 2026-09-06) re-triggers the finding on
// the new line number and fails the Secrets job on the next promotion, whose
// base branch only gains ignore entries through the promotion itself.
//
// .gitleaks.toml now allowlists the placeholder by pattern instead of by
// line: `condition = "and"` requires both the content/docs/ path and the
// "your-token-here" text to match, so a docs reflow can never re-trigger it
// and a real credential anywhere else still fires. This test drives gitleaks
// itself against the repo's real config to prove both halves, the same way
// gitleaks-api-key-rule.test.ts does for the drydock-api-key rule.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const gitleaksConfigPath = join(repoRoot, '.gitleaks.toml');
const webhooksDocPath = join(repoRoot, 'content/docs/current/configuration/webhooks/index.mdx');

interface GitleaksFinding {
  RuleID: string;
  File: string;
}

function runGitleaks(scanDir: string): GitleaksFinding[] {
  const reportPath = join(scanDir, 'report.json');
  // scripts/scan-secrets.sh cd's into the tracked tree and scans "." rather
  // than passing an absolute path, so gitleaks reports (and the .gitleaks.toml
  // allowlist's `paths` regex matches against) repo-relative paths like
  // "content/docs/...". Scanning an absolute path here would report absolute
  // paths instead and never exercise the allowlist the way real CI does.
  // --exit-code 0 keeps a finding off the process exit status, so a real
  // detection is read out of the report rather than from a thrown error.
  execFileSync(
    'gitleaks',
    [
      'dir',
      '.',
      '--config',
      gitleaksConfigPath,
      '--no-banner',
      '--report-format',
      'json',
      '--report-path',
      reportPath,
      '--exit-code',
      '0',
    ],
    { cwd: scanDir, stdio: 'ignore' },
  );
  const raw = readFileSync(reportPath, 'utf8').trim();
  return raw === '' || raw === 'null' ? [] : (JSON.parse(raw) as GitleaksFinding[]);
}

// Skipped where the binary is absent so the suite stays runnable without it —
// CI installs gitleaks in ci-verify.yml.
const hasGitleaks = spawnSync('gitleaks', ['version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!hasGitleaks)('gitleaks content/docs placeholder allowlist', () => {
  it('finds nothing in a shifted copy of the webhooks doc', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'drydock-gitleaks-docs-shift-'));
    try {
      const shiftedDocPath = join(
        workspace,
        'content/docs/current/configuration/webhooks/index.mdx',
      );
      mkdirSync(dirname(shiftedDocPath), { recursive: true });
      const original = readFileSync(webhooksDocPath, 'utf8');
      // Three blank lines at the top reproduces the 2026-09-06 incident: the
      // doc edit that moved the curl examples down two lines and stranded
      // .gitleaksignore's line-pinned fingerprints.
      writeFileSync(shiftedDocPath, `\n\n\n${original}`);

      const findings = runGitleaks(workspace);
      expect(findings).toEqual([]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('still reports a real-looking credential outside content/docs', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'drydock-gitleaks-docs-control-'));
    try {
      const outsideDocPath = join(workspace, 'other/leak.mdx');
      mkdirSync(dirname(outsideDocPath), { recursive: true });
      // Assembled from fragments at run time, with curl, -H, the header name
      // and the credential value never adjacent on one source line: gitleaks
      // scans this very file's tracked source too, and a literal
      // "curl ... -H \"Authorization: Bearer <value>\"" pattern here would
      // trip the same curl-auth-header rule the control is exercising. The
      // header name is split across two string literals so the word
      // "Authorization" never appears intact in this file's source, only in
      // the text written out to the temp workspace below.
      const curlCommand = 'curl';
      const headerFlag = '-H';
      const headerNamePrefix = 'Authoriz';
      const headerNameSuffix = 'ation';
      const headerName = `${headerNamePrefix}${headerNameSuffix}`;
      const authScheme = 'Bearer';
      const credentialValue = 'your-token-here';
      const fixtureLines = [
        `${curlCommand} -X POST https://example.com \\`,
        `  ${headerFlag} "${headerName}: ${authScheme} ${credentialValue}"`,
        '',
      ];
      writeFileSync(outsideDocPath, fixtureLines.join('\n'));

      const findings = runGitleaks(workspace);
      expect(findings.map((finding) => finding.RuleID)).toContain('curl-auth-header');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
