import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  convertZapJsonToSarif,
  IGNORED_ZAP_PLUGIN_IDS,
  stripMarkup,
} from './zap-json-to-sarif.mjs';

describe('zap-json-to-sarif', () => {
  test('strips basic ZAP HTML markup from text fields', () => {
    assert.equal(stripMarkup('<p>Fix &amp; verify</p><p>Next line</p>'), 'Fix & verify\nNext line');
  });

  test('returns empty text for null markup fields', () => {
    assert.equal(stripMarkup(null), '');
  });

  test('does not double-decode ampersand-encoded entities', () => {
    // `&amp;lt;` must resolve to `&lt;`, not `<`. Otherwise an attacker who
    // can influence ZAP otherinfo can smuggle markup past the strip pass.
    assert.equal(
      stripMarkup('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;'),
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  test('percent-encodes every colon in an IPv6 host and port', () => {
    const sarif = convertZapJsonToSarif({
      site: [
        {
          '@name': 'http://[::1]:3333',
          alerts: [
            {
              pluginid: '10055',
              alertRef: '10055-6',
              alert: 'CSP: style-src unsafe-inline',
              name: 'CSP: style-src unsafe-inline',
              riskcode: '2',
              confidence: '3',
              riskdesc: 'Medium (High)',
              instances: [{ uri: 'http://[::1]:3333/x', method: 'GET' }],
            },
          ],
        },
      ],
    });

    assert.equal(
      sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
      '[%3A%3A1]%3A3333/x',
    );
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
    // http URIs lose the scheme but keep the host so alerts stay per-site.
    // The root path keeps its '/' — GHAS rejects empty artifactLocation.uri.
    // The port colon is percent-encoded so the value isn't parsed as a scheme.
    assert.equal(
      sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
      'localhost%3A3333/',
    );
    assert.equal(
      'uriBaseId' in sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation,
      false,
    );
    assert.equal('originalUriBaseIds' in sarif.runs[0], false);
    assert.match(sarif.runs[0].results[0].message.text, /Evidence:/);
    // automationDetails.id must stay absent so upload-sarif's `category:` input
    // is the only thing that sets the run's code-scanning category. GitHub
    // derives the category from runAutomationDetails.id up to the final slash
    // and does not let `category:` override an id already present in the
    // SARIF, so a hardcoded slashless id here collapses every ZAP scan
    // (app baseline, zap-web-getdrydock, zap-web-demo-baseline) into one
    // empty-category configuration that clobbers the others' alerts.
    assert.equal('automationDetails' in sarif.runs[0], false);
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
      'localhost%3A3333/singleton',
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

    // http URIs become host-prefixed paths (leading slash preserved);
    // non-http fallbacks ('zap-target') pass through unchanged.
    assert.deepEqual(
      sarif.runs[0].results.map(
        (result) => result.locations[0].physicalLocation.artifactLocation.uri,
      ),
      ['fallback.example/node', 'fallback.example/', 'zap-target'],
    );
    assert.equal('originalUriBaseIds' in sarif.runs[0], false);
  });

  test('keeps the scanned host in the location so each site gets its own alert', () => {
    const sarif = convertZapJsonToSarif({
      site: [
        {
          alerts: [
            {
              alertRef: '90004-2',
              alert: 'Missing COEP',
              instances: [
                { uri: 'https://getdrydock.com/' },
                { uri: 'https://demo.getdrydock.com/' },
                { uri: 'http://localhost:3333/' },
                { uri: 'https://getdrydock.com/robots.txt?a=1' },
              ],
            },
          ],
        },
      ],
    });

    assert.deepEqual(
      sarif.runs[0].results.map(
        (result) => result.locations[0].physicalLocation.artifactLocation.uri,
      ),
      [
        'getdrydock.com/',
        'demo.getdrydock.com/',
        'localhost%3A3333/',
        'getdrydock.com/robots.txt?a=1',
      ],
    );
    assert.equal('originalUriBaseIds' in sarif.runs[0], false);
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

  test('IGNORED_ZAP_PLUGIN_IDS contains plugin 10049', () => {
    assert.ok(IGNORED_ZAP_PLUGIN_IDS.has('10049'));
  });

  test('IGNORED_ZAP_PLUGIN_IDS contains plugin 10109', () => {
    assert.ok(IGNORED_ZAP_PLUGIN_IDS.has('10109'));
  });

  test('keeps plugin 10055 out of IGNORED_ZAP_PLUGIN_IDS so the accepted risk stays visible', () => {
    assert.ok(!IGNORED_ZAP_PLUGIN_IDS.has('10055'));
  });

  test('drops plugin 10109 alerts from rules and results entirely', () => {
    const sarif = convertZapJsonToSarif({
      site: [
        {
          '@name': 'http://localhost:3333',
          alerts: [
            {
              pluginid: '10109',
              alertRef: '10109',
              alert: 'Modern Web Application',
              name: 'Modern Web Application',
              riskcode: '0',
              instances: [{ uri: 'http://localhost:3333/', method: 'GET' }],
            },
          ],
        },
      ],
    });
    assert.ok(
      !sarif.runs[0].tool.driver.rules.some((r) => r.id.startsWith('10109')),
      'rule 10109 must be excluded',
    );
    assert.equal(sarif.runs[0].results.length, 0);
  });

  test('drops plugin 10049 alerts from rules and results entirely', () => {
    const sarif = convertZapJsonToSarif({
      site: [
        {
          '@name': 'http://localhost:3333',
          alerts: [
            {
              pluginid: '10049',
              alertRef: '10049-3',
              alert: 'Storable and Cacheable Content',
              name: 'Storable and Cacheable Content',
              riskcode: '0',
              instances: [{ uri: 'http://localhost:3333/assets/icons-CQFCvl7r.js', method: 'GET' }],
            },
            {
              pluginid: '10055',
              alertRef: '10055-6',
              alert: 'CSP: style-src unsafe-inline',
              name: 'CSP: style-src unsafe-inline',
              riskcode: '2',
              instances: [{ uri: 'http://localhost:3333/', method: 'GET' }],
            },
          ],
        },
      ],
    });

    // 10049 must not appear in rules
    assert.ok(
      !sarif.runs[0].tool.driver.rules.some((r) => r.id.startsWith('10049')),
      'rule 10049 must be excluded',
    );
    // 10049 must not appear in results
    assert.ok(
      !sarif.runs[0].results.some((r) => r.ruleId.startsWith('10049')),
      'result for 10049 must be excluded',
    );
    // The non-ignored alert must still be present
    assert.equal(sarif.runs[0].tool.driver.rules.length, 1);
    assert.equal(sarif.runs[0].tool.driver.rules[0].id, '10055-6');
    assert.equal(sarif.runs[0].results.length, 1);
    assert.equal(sarif.runs[0].results[0].ruleId, '10055-6');
  });

  test('drops all 10049 alertRef variants regardless of suffix', () => {
    const sarif = convertZapJsonToSarif({
      site: [
        {
          alerts: [
            {
              pluginid: '10049',
              alertRef: '10049-1',
              alert: 'Storable and Cacheable Content',
              riskcode: '0',
            },
            {
              pluginid: '10049',
              alertRef: '10049-2',
              alert: 'Storable and Cacheable Content',
              riskcode: '0',
            },
            {
              pluginid: '10049',
              alertRef: '10049-3',
              alert: 'Storable and Cacheable Content',
              riskcode: '0',
            },
          ],
        },
      ],
    });

    assert.equal(sarif.runs[0].tool.driver.rules.length, 0, 'no rules for any 10049 variant');
    assert.equal(sarif.runs[0].results.length, 0, 'no results for any 10049 variant');
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
