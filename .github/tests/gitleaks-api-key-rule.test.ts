import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The `ddk_` prefix on a Drydock API key is fixed so that secret scanners can
// match it, and this rule is the whole reason the prefix is worth having: it
// makes Drydock's own CI catch a leaked Drydock key. The spec calls it out as
// a Done-when item, so it is covered here rather than left to a manual scan.
//
// Two things can rot independently, so both are asserted:
//   1. the rule can disappear from .gitleaks.toml, and
//   2. app/store/api-key.ts's API_KEY_PATTERN can change shape while the
//      scanner keeps looking for the old one, which fails open.
//
// No literal credential appears in this file. Writing one would make gitleaks
// flag this very test as a leak — the same trap release-cut-changelog-conflict-
// markers.test.ts hit with literal conflict markers — so every fixture is
// assembled with string concatenation at run time.
const gitleaksConfigPath = fileURLToPath(new URL('../../.gitleaks.toml', import.meta.url));
const apiKeyStorePath = fileURLToPath(new URL('../../app/store/api-key.ts', import.meta.url));

const RULE_ID = 'drydock-api-key';
const CREDENTIAL_PREFIX = 'ddk_';

/** The shape both sources must agree on, written once. */
const EXPECTED_BODY_REGEX = `${CREDENTIAL_PREFIX}[0-9a-f]{12}_[A-Za-z0-9_-]{43}`;

function readGitleaksConfig(): string {
  return readFileSync(gitleaksConfigPath, 'utf8');
}

/**
 * Pull the regex out of the `[[rules]]` block whose id is RULE_ID. Done
 * textually rather than with a TOML parser because the repo carries no TOML
 * dependency, and because asserting on the literal source text is what
 * catches a rule that was edited into a different block.
 */
function extractRuleRegex(config: string): string | undefined {
  const ruleBlocks = config.split('[[rules]]').slice(1);
  const block = ruleBlocks.find((candidate) => candidate.includes(`id = "${RULE_ID}"`));
  if (block === undefined) {
    return undefined;
  }
  const match = block.match(/regex = '''(.*?)'''/s);
  return match?.[1];
}

/** Pull the `API_KEY_PATTERN` literal out of the store module's source. */
function extractStorePatternSource(): string {
  const source = readFileSync(apiKeyStorePath, 'utf8');
  const match = source.match(/API_KEY_PATTERN = \/(.*?)\/;/);
  if (!match?.[1]) {
    throw new Error('API_KEY_PATTERN literal not found in app/store/api-key.ts');
  }
  return match[1];
}

/**
 * Reduce the store's anchored, capturing pattern to the bare body the scanner
 * uses: gitleaks matches anywhere in a line, so it carries neither the anchors
 * nor the capture groups.
 */
function toScannerBody(storePattern: string): string {
  return storePattern.replace(/^\^/, '').replace(/\$$/, '').replaceAll('(', '').replaceAll(')', '');
}

function buildCredential(keyId: string, secret: string): string {
  return `${CREDENTIAL_PREFIX}${keyId}_${secret}`;
}

const VALID_KEY_ID = 'a1b2c3d4e5f6';
const VALID_SECRET = 'A'.repeat(43);

describe('gitleaks drydock-api-key rule', () => {
  it('is registered in .gitleaks.toml', () => {
    const config = readGitleaksConfig();
    expect(config).toContain('[[rules]]');
    expect(config).toContain(`id = "${RULE_ID}"`);
    expect(extractRuleRegex(config)).toBe(EXPECTED_BODY_REGEX);
  });

  it('keeps the default ruleset extended', () => {
    // Adding a rule must not replace the upstream AWS/GitHub/Slack rules.
    expect(readGitleaksConfig()).toContain('useDefault = true');
  });

  it('declares the prefix as a keyword so the rule is reachable', () => {
    // gitleaks only evaluates a rule's regex on lines containing one of its
    // keywords. A rule with a correct regex and no keyword never fires.
    const config = readGitleaksConfig();
    const block = config.split('[[rules]]').find((candidate) => candidate.includes(RULE_ID));
    expect(block).toContain(`keywords = ["${CREDENTIAL_PREFIX}"]`);
  });

  it('matches the credential shape app/store/api-key.ts actually generates', () => {
    expect(toScannerBody(extractStorePatternSource())).toBe(EXPECTED_BODY_REGEX);
  });

  it('matches a full-shape credential', () => {
    const rule = new RegExp(EXPECTED_BODY_REGEX);
    expect(rule.test(buildCredential(VALID_KEY_ID, VALID_SECRET))).toBe(true);
    expect(rule.test(`DD_KEY=${buildCredential(VALID_KEY_ID, VALID_SECRET)}`)).toBe(true);
  });

  it.each([
    ['a non-hex key id', buildCredential('zzzzzzzzzzzz', VALID_SECRET)],
    ['a short key id', buildCredential('a1b2c3', VALID_SECRET)],
    ['a short secret', buildCredential(VALID_KEY_ID, 'A'.repeat(20))],
    ['the display prefix the API returns', `${CREDENTIAL_PREFIX}${VALID_KEY_ID}`],
    ['an unrelated bearer value', 'Bearer abc123'],
  ])('does not match %s', (_label, candidate) => {
    expect(new RegExp(EXPECTED_BODY_REGEX).test(candidate)).toBe(false);
  });
});

// The assertions above prove the regex; this one proves gitleaks itself acts
// on it with the repo's real config. Skipped where the binary is absent so the
// suite stays runnable without it — CI installs gitleaks in ci-verify.yml.
const hasGitleaks = spawnSync('gitleaks', ['version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!hasGitleaks)('gitleaks binary with the repo config', () => {
  it('reports a leaked Drydock API key', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'drydock-gitleaks-'));
    try {
      writeFileSync(
        join(workspace, 'leaked.env'),
        `DD_KEY=${buildCredential(VALID_KEY_ID, VALID_SECRET)}\n`,
      );
      const reportPath = join(workspace, 'report.json');

      // --exit-code 0 keeps a finding off the process exit status, so a real
      // detection is read out of the report rather than from a thrown error.
      execFileSync(
        'gitleaks',
        [
          'detect',
          '--no-git',
          '--source',
          workspace,
          '--config',
          gitleaksConfigPath,
          '--report-format',
          'json',
          '--report-path',
          reportPath,
          '--exit-code',
          '0',
        ],
        { stdio: 'ignore' },
      );

      const findings = JSON.parse(readFileSync(reportPath, 'utf8')) as Array<{ RuleID: string }>;
      expect(findings.map((finding) => finding.RuleID)).toContain(RULE_ID);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
