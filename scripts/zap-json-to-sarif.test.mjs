import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { convertZapJsonToSarif, stripMarkup } from './zap-json-to-sarif.mjs';

describe('zap-json-to-sarif', () => {
  test('strips basic ZAP HTML markup from text fields', () => {
    assert.equal(stripMarkup('<p>Fix &amp; verify</p><p>Next line</p>'), 'Fix & verify\nNext line');
  });

  test('returns empty text for null markup fields', () => {
    assert.equal(stripMarkup(null), '');
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
    assert.ok(sarif.runs[0].tool.driver.rules[0].properties.tags.includes('external/cwe/cwe-693'));
    assert.equal(sarif.runs[0].results.length, 2);
    assert.equal(sarif.runs[0].results[0].ruleId, '10055-6');
    assert.equal(sarif.runs[0].results[0].level, 'warning');
    assert.equal(
      sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
      'http://localhost:3333/',
    );
    assert.match(sarif.runs[0].results[0].message.text, /Evidence:/);
  });

  test('maps non-medium ZAP risk codes to SARIF levels and security severities', () => {
    const sarif = convertZapJsonToSarif({
      site: {
        '@name': 'http://localhost:3333',
        alerts: [
          { alertRef: 'high-risk', alert: 'High', riskcode: '3' },
          { alertRef: 'low-risk', alert: 'Low', riskcode: '1' },
          { alertRef: 'info-risk', alert: 'Info', riskcode: '0' },
          { alertRef: 'unknown-risk', alert: 'Unknown', riskcode: 'unexpected' },
        ],
      },
    });

    const ruleById = new Map(sarif.runs[0].tool.driver.rules.map((rule) => [rule.id, rule]));
    assert.equal(ruleById.get('high-risk').defaultConfiguration.level, 'error');
    assert.equal(ruleById.get('high-risk').properties['security-severity'], '9.0');
    assert.equal(ruleById.get('low-risk').defaultConfiguration.level, 'note');
    assert.equal(ruleById.get('low-risk').properties['security-severity'], '3.0');
    assert.equal(ruleById.get('info-risk').defaultConfiguration.level, 'note');
    assert.equal(ruleById.get('info-risk').properties['security-severity'], '0.0');
    assert.equal(ruleById.get('unknown-risk').defaultConfiguration.level, 'warning');
    assert.equal(ruleById.get('unknown-risk').properties['security-severity'], '1.0');

    assert.deepEqual(
      sarif.runs[0].results.map((result) => result.level),
      ['error', 'note', 'note', 'warning'],
    );
  });

  test('wraps singleton site, alert, and instance objects', () => {
    const sarif = convertZapJsonToSarif({
      site: {
        '@name': 'http://localhost:3333',
        alerts: {
          alertRef: 'singleton-alert',
          alert: 'Singleton alert',
          riskcode: '1',
          instances: {
            uri: 'http://localhost:3333/singleton',
            evidence: 'single instance',
          },
        },
      },
    });

    assert.equal(sarif.runs[0].tool.driver.rules.length, 1);
    assert.equal(sarif.runs[0].results.length, 1);
    assert.equal(sarif.runs[0].results[0].ruleId, 'singleton-alert');
    assert.equal(
      sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
      'http://localhost:3333/singleton',
    );
  });

  test('suppresses invalid CWE and WASC tags', () => {
    const sarif = convertZapJsonToSarif({
      site: [
        {
          alerts: [
            { alertRef: 'negative-ids', alert: 'Negative IDs', cweid: '-1', wascid: '-1' },
            { alertRef: 'zero-ids', alert: 'Zero IDs', cweid: '0', wascid: '0' },
          ],
        },
      ],
    });

    for (const rule of sarif.runs[0].tool.driver.rules) {
      assert.ok(!rule.properties.tags.some((tag) => tag.startsWith('external/cwe/')));
      assert.ok(!rule.properties.tags.some((tag) => tag.startsWith('wasc-')));
    }
  });

  test('falls back across instance nodeName, site name, and default target URIs', () => {
    const sarif = convertZapJsonToSarif({
      site: [
        {
          '@name': 'http://fallback.example',
          alerts: [
            {
              alertRef: 'node-name',
              alert: 'Node name',
              instances: [{ nodeName: 'http://fallback.example/node' }],
            },
            {
              alertRef: 'site-name',
              alert: 'Site name',
              instances: [{}],
            },
          ],
        },
        {
          alerts: [{ alertRef: 'default-target', alert: 'Default target' }],
        },
      ],
    });

    assert.deepEqual(
      sarif.runs[0].results.map(
        (result) => result.locations[0].physicalLocation.artifactLocation.uri,
      ),
      ['http://fallback.example/node', 'http://fallback.example', 'zap-target'],
    );
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

  test('CLI exits with usage when required arguments are missing', () => {
    const result = spawnSync(
      'node',
      [new URL('./zap-json-to-sarif.mjs', import.meta.url).pathname],
      {
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: zap-json-to-sarif\.mjs/);
  });
});
