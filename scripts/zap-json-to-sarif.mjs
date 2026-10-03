#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
const ZAP_INFORMATION_URI = 'https://www.zaproxy.org/';

// ZAP plugin IDs to drop from the SARIF/code-scanning surface. 10049
// ("Storable and Cacheable Content") is an informational passive rule that
// fires on every content-hashed static asset (e.g. /assets/*-<hash>.js).
// Those assets are immutable and intentionally cacheable and hold no
// sensitive data, so the alert is a false positive that otherwise recurs
// under a new hash on every build. 10109 ("Modern Web Application") is a
// pure SPA-detection notice, not a finding, and recurs on every scan.
// Accepted real risks (e.g. 10055 CSP style-src unsafe-inline) stay OUT of
// this set so they remain visible in code scanning; they are gate-suppressed
// in .zap/rules.tsv instead.
export const IGNORED_ZAP_PLUGIN_IDS = new Set(['10049', '10109']);

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function decodeEntities(value) {
  // Decode `&amp;` LAST so that inputs like `&amp;lt;` resolve to the literal
  // `&lt;` instead of being double-decoded into `<`. Same reason every other
  // entity is decoded before this — the `&` produced by `&amp;` must never
  // re-enter the entity-decoder.
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

export function stripMarkup(value) {
  if (value === undefined || value === null) {
    return '';
  }
  let stripped = decodeEntities(String(value))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n');
  // Loop until stable: a single pass of `<[^>]*>` can leave overlapping
  // tags intact (e.g. `<<script>script>` collapses to `<script>` after one
  // pass). CodeQL flags this as incomplete-multi-character-sanitization.
  let previous;
  do {
    previous = stripped;
    stripped = stripped.replace(/<[^>]*>/g, '');
  } while (stripped !== previous);
  return stripped.replace(/\n{3,}/g, '\n\n').trim();
}

function firstUrl(value) {
  const match = String(value ?? '').match(/https?:\/\/[^\s<)]+/);
  return match?.[0]?.replace(/[.,;]+$/, '');
}

function riskLevel(riskCode) {
  switch (String(riskCode ?? '')) {
    case '3':
      return 'error';
    case '2':
      return 'warning';
    case '1':
    case '0':
      return 'note';
    default:
      return 'warning';
  }
}

function securitySeverity(riskCode) {
  switch (String(riskCode ?? '')) {
    case '3':
      return '9.0';
    case '2':
      return '6.0';
    case '1':
      return '3.0';
    case '0':
      return '0.0';
    default:
      return '1.0';
  }
}

function ruleId(alert) {
  return String(
    alert.alertRef || alert.pluginid || alert.name || alert.alert || 'unknown-zap-alert',
  );
}

function buildRule(alert) {
  const id = ruleId(alert);
  const tags = ['security', 'zaproxy'];
  if (alert.pluginid) {
    tags.push(`zap-plugin-${alert.pluginid}`);
  }
  if (alert.cweid && String(alert.cweid) !== '-1' && String(alert.cweid) !== '0') {
    tags.push(`external/cwe/cwe-${alert.cweid}`);
  }
  if (alert.wascid && String(alert.wascid) !== '-1' && String(alert.wascid) !== '0') {
    tags.push(`wasc-${alert.wascid}`);
  }

  return {
    id,
    name: alert.name || alert.alert || id,
    shortDescription: {
      text: alert.alert || alert.name || id,
    },
    fullDescription: {
      text: stripMarkup(alert.desc),
    },
    help: {
      text: stripMarkup(
        [alert.solution, alert.otherinfo, alert.reference].filter(Boolean).join('\n\n'),
      ),
    },
    ...(firstUrl(alert.reference) ? { helpUri: firstUrl(alert.reference) } : {}),
    defaultConfiguration: {
      level: riskLevel(alert.riskcode),
    },
    properties: {
      precision: 'medium',
      'security-severity': securitySeverity(alert.riskcode),
      tags,
    },
  };
}

function resultMessage(alert, instance) {
  const parts = [alert.alert || alert.name || ruleId(alert)];
  const evidence = stripMarkup(instance.evidence);
  const otherInfo = stripMarkup(instance.otherinfo || alert.otherinfo);
  if (evidence) {
    parts.push(`Evidence: ${evidence}`);
  }
  if (otherInfo) {
    parts.push(otherInfo);
  }
  return parts.join('\n\n');
}

/**
 * Turn a raw URI from ZAP into a scheme-less `host/path` artifactLocation.uri.
 *
 * Code Scanning rejects absolute http(s) URIs (they don't match the `file://`
 * checkout scheme), so the scheme goes. The host stays in the location because
 * GitHub keys an alert on rule + location: stripping the origin made
 * getdrydock.com, the demo and the app scan share one alert per rule and path,
 * so dismissing one hid regressions on the others. A port's colon is
 * percent-encoded because `localhost:3333/x` would otherwise parse as a URI
 * with a `localhost` scheme.
 */
function resolveArtifactLocation(rawUri) {
  try {
    const parsed = new URL(rawUri);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      // Keep the leading slash so the root path becomes '/' instead of ''.
      // GHAS Code Scanning rejects empty artifactLocation.uri values
      // (locationFromSarifResult: expected artifact location).
      const path = parsed.pathname + parsed.search + parsed.hash;
      return { uri: `${parsed.host.replace(':', '%3A')}${path}` };
    }
  } catch {
    // Not a URL — fall through and return as-is.
  }
  return { uri: rawUri };
}

function buildResult(alert, instance, siteName) {
  const rawUri = instance.uri || instance.nodeName || siteName || 'zap-target';
  const { uri } = resolveArtifactLocation(rawUri);
  const properties = {
    confidence: alert.confidence,
    risk: alert.riskdesc,
    method: instance.method,
    parameter: instance.param,
    attack: instance.attack,
    evidence: instance.evidence,
    zapAlertRef: alert.alertRef,
    zapPluginId: alert.pluginid,
  };

  return {
    ruleId: ruleId(alert),
    level: riskLevel(alert.riskcode),
    message: {
      text: resultMessage(alert, instance),
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri,
          },
        },
      },
    ],
    properties: Object.fromEntries(
      Object.entries(properties).filter(([, value]) => value !== undefined && value !== ''),
    ),
  };
}

export function convertZapJsonToSarif(zapReport) {
  const ruleMap = new Map();
  const results = [];

  for (const site of asArray(zapReport?.site)) {
    for (const alert of asArray(site?.alerts)) {
      if (IGNORED_ZAP_PLUGIN_IDS.has(String(alert.pluginid))) {
        continue;
      }
      const id = ruleId(alert);
      if (!ruleMap.has(id)) {
        ruleMap.set(id, buildRule(alert));
      }

      const instances = asArray(alert.instances);
      if (instances.length === 0) {
        results.push(buildResult(alert, {}, site?.['@name']));
      } else {
        for (const instance of instances) {
          results.push(buildResult(alert, instance, site?.['@name']));
        }
      }
    }
  }

  return {
    version: '2.1.0',
    $schema: SARIF_SCHEMA,
    runs: [
      {
        tool: {
          driver: {
            name: 'OWASP ZAP Baseline',
            informationUri: ZAP_INFORMATION_URI,
            rules: [...ruleMap.values()],
          },
        },
        results,
      },
    ],
  };
}

function parseArgs(argv) {
  const options = { input: '', output: '' };
  for (const arg of argv) {
    if (arg.startsWith('--input=')) {
      options.input = arg.slice('--input='.length);
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
    }
  }
  return options;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input || !options.output) {
    fail('Usage: zap-json-to-sarif.mjs --input=<zap-json-report> --output=<sarif-output>');
  }

  const zapReport = JSON.parse(readFileSync(options.input, 'utf8'));
  const sarif = convertZapJsonToSarif(zapReport);
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(sarif, null, 2)}\n`, 'utf8');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
