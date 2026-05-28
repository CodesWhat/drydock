import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';

import { convertZapJsonToSarif, stripMarkup } from './zap-json-to-sarif.mjs';

describe('zap-json-to-sarif', () => {
  test('strips basic ZAP HTML markup from text fields', () => {
    assert.equal(stripMarkup('<p>Fix &amp; verify</p><p>Next line</p>'), 'Fix & verify\nNext line');
  });

  test('converts ZAP alerts and instances to SARIF rules and results', () => {
    const sarif = convertZapJsonToSarif({
      site: [
        {
          '@name': 'http://localhost:3333',
          alerts: [
            {
              pluginid: '10055',
              alertRef: '10055-6',
              alert: 'CSP: style-src unsafe-inline',
              name: 'CSP: style-src unsafe-inline',
              riskcode: '2',
              confidence: '3',
              riskdesc: 'Medium (High)',
              desc: '<p>CSP issue</p>',
              solution: '<p>Tighten CSP</p>',
              reference: '<p>https://www.w3.org/TR/CSP/</p>',
              cweid: '693',
              wascid: '15',
              instances: [
                {
                  uri: 'http://localhost:3333/',
                  method: 'GET',
                  param: 'Content-Security-Policy',
                  evidence: "style-src 'unsafe-inline'",
                  otherinfo: 'style-src includes unsafe-inline.',
                },
                {
                  uri: 'http://localhost:3333/robots.txt',
                  method: 'GET',
                  param: 'Content-Security-Policy',
                  evidence: "style-src 'unsafe-inline'",
                },
              ],
            },
          ],
        },
      ],
    });

    assert.equal(sarif.version, '2.1.0');
    assert.equal(sarif.runs[0].tool.driver.name, 'OWASP ZAP Baseline');
    assert.equal(sarif.runs[0].tool.driver.rules.length, 1);
    assert.equal(sarif.runs[0].tool.driver.rules[0].id, '10055-6');
    assert.equal(sarif.runs[0].tool.driver.rules[0].defaultConfiguration.level, 'warning');
    assert.equal(sarif.runs[0].tool.driver.rules[0].properties['security-severity'], '6.0');
    assert.ok(
      sarif.runs[0].tool.driver.rules[0].properties.tags.includes('external/cwe/cwe-693'),
    );
    assert.equal(sarif.runs[0].results.length, 2);
    assert.equal(sarif.runs[0].results[0].ruleId, '10055-6');
    assert.equal(sarif.runs[0].results[0].level, 'warning');
    assert.equal(
      sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
      'http://localhost:3333/',
    );
    assert.match(sarif.runs[0].results[0].message.text, /Evidence:/);
  });

  test('writes SARIF from the CLI entry point', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zap-sarif-'));
    try {
      const input = join(dir, 'zap.json');
      const output = join(dir, 'zap.sarif');
      writeFileSync(input, JSON.stringify({ site: [] }), 'utf8');

      execFileSync('node', [
        new URL('./zap-json-to-sarif.mjs', import.meta.url).pathname,
        `--input=${input}`,
        `--output=${output}`,
      ]);

      const sarif = JSON.parse(readFileSync(output, 'utf8'));
      assert.deepEqual(sarif.runs[0].results, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
