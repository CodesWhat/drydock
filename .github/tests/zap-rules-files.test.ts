// The public-site ZAP scans (getdrydock.com and the demo) use their own rules
// file so dismissed false positives and accepted risks stop failing the weekly
// DAST gate without loosening the app scan in ci-verify.yml. The shared
// .zap/rules.tsv must stay the only file the app scan reads, and every shared
// rule must carry over to the public-site file, or the two silently diverge.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const rules = (text: string) =>
  text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => {
      const [id, action] = line.split('\t');
      return { id, action, line };
    });

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
}

const zapSteps = (workflowFile: string): Step[] => {
  const workflow = yaml.parse(read(`../workflows/${workflowFile}`)) as {
    jobs: Record<string, { steps?: Step[] }>;
  };
  return Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.uses?.startsWith('zaproxy/action-'));
};

const shared = rules(read('../../.zap/rules.tsv'));
const publicSite = rules(read('../../.zap/rules-public-site.tsv'));

// Rules that must keep firing against the app scan. Content-matching rules
// match docs prose on the public sites, and the header rules only reflect
// accepted choices for the static sites.
const PUBLIC_SITE_ONLY_IGNORES = [
  '10098',
  '10099',
  '2',
  '10096',
  '10110',
  '10023',
  '90022',
  '40025',
  '10104',
  '90004-1',
  '90004-2',
];

test('the shared rules file does not ignore the public-site-only rules', () => {
  const sharedIds = shared.map((rule) => rule.id);

  for (const id of PUBLIC_SITE_ONLY_IGNORES) {
    expect(sharedIds).not.toContain(id);
  }
});

test('the public-site rules file carries every shared rule verbatim', () => {
  for (const rule of shared) {
    expect(publicSite.map((r) => r.line)).toContain(rule.line);
  }
});

test('the public-site rules file adds exactly the expected IGNORE rules', () => {
  const sharedLines = new Set(shared.map((rule) => rule.line));
  const extras = publicSite.filter((rule) => !sharedLines.has(rule.line));

  expect(extras.map((rule) => rule.id)).toEqual(PUBLIC_SITE_ONLY_IGNORES);
  for (const rule of extras) {
    expect(rule.action).toBe('IGNORE');
    expect(rule.line.split('\t')[2]?.length ?? 0).toBeGreaterThan(20);
  }
});

test('COOP (90004-3) and the whole 90004 plugin stay un-ignored on the public sites', () => {
  const ids = publicSite.map((rule) => rule.id);

  expect(ids).not.toContain('90004');
  expect(ids).not.toContain('90004-3');
});

test('both public-site ZAP scans use the public-site rules file', () => {
  const steps = zapSteps('security-dast-web.yml');

  expect(steps).toHaveLength(2);
  for (const step of steps) {
    expect(step.with?.rules_file_name).toBe('.zap/rules-public-site.tsv');
  }
});

test('the app ZAP scan in ci-verify keeps the shared rules file', () => {
  const steps = zapSteps('ci-verify.yml');

  expect(steps.length).toBeGreaterThan(0);
  for (const step of steps) {
    expect(step.with?.rules_file_name).toBe('.zap/rules.tsv');
  }
});
