import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFile } from './loader.js';
import { mergeConfigLayers } from './sources.js';
import { validateConfiguration } from './validate.js';

/**
 * Pins the repo-root `drydock.example.yml` to the fenced example on the
 * config file docs page (roadmap 7.1 slice 8) — the anti-drift mechanism the
 * spec asks for, since `apps/web/scripts/sync-docs.mjs` can't reach a root
 * file and the two copies would otherwise silently rot apart. Also proves
 * the example is a real, valid `drydock.yml`: it parses, flattens, and
 * validates against every real component schema through the same
 * `loadConfigFile`/`validateConfiguration` path real startup uses.
 *
 * `config-cli.test.ts`'s own "drydock.example.yml parses and validates" test
 * already covers this through the CLI wrapper (`config validate --file`),
 * placeholder handling included. This file covers the lower-level path
 * directly, plus the docs-fence pin that test doesn't touch.
 *
 * No filesystem access at import time: both files are read inside the test
 * bodies below with `node:fs/promises`, matching every other
 * `configuration/file/*.test.ts` in this directory.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const EXAMPLE_FILE_PATH = path.join(REPO_ROOT, 'drydock.example.yml');
const DOCS_PAGE_PATH = path.join(
  REPO_ROOT,
  'content/docs/current/configuration/config-file/index.mdx',
);

// The marker comment the docs page carries directly above the fence, so this
// test locates the right fence by content rather than by a brittle line
// number or "the Nth ```yaml block on the page".
const DOCS_FENCE_MARKER = '{/*drydock.example.yml*/}';
const YAML_FENCE_OPEN = '```yaml\n';
const YAML_FENCE_CLOSE = '\n```';

// Mirrors config-cli.ts's own SECRET_PLACEHOLDER_VALUE and the reasoning
// behind it: validateConfiguration is a pure function of the candidate env
// map, and resolving a real `_file`/`__FILE` reference is replaceSecrets's
// job at real startup, not this test's. Standing in for it here is what lets
// the example validate without the referenced secret files (/run/secrets/*)
// existing on whatever machine runs this test.
const SECRET_FILE_KEY_SUFFIX = '__FILE';
const SECRET_PLACEHOLDER_VALUE = 'placeholder-secret-value-for-validation-only';

function resolveSecretPlaceholders(candidateEnv: Record<string, string | undefined>): void {
  for (const key of Object.keys(candidateEnv)) {
    if (!key.endsWith(SECRET_FILE_KEY_SUFFIX)) {
      continue;
    }
    const baseKey = key.slice(0, -SECRET_FILE_KEY_SUFFIX.length);
    if (candidateEnv[baseKey] === undefined) {
      candidateEnv[baseKey] = SECRET_PLACEHOLDER_VALUE;
    }
    delete candidateEnv[key];
  }
}

/** Extracts the ```yaml fence immediately following DOCS_FENCE_MARKER. */
function extractFencedExample(docsPageText: string): string {
  const markerIndex = docsPageText.indexOf(DOCS_FENCE_MARKER);
  if (markerIndex === -1) {
    throw new Error(`docs page is missing the "${DOCS_FENCE_MARKER}" marker comment`);
  }
  const afterMarker = docsPageText.slice(markerIndex + DOCS_FENCE_MARKER.length);
  const fenceOpenIndex = afterMarker.indexOf(YAML_FENCE_OPEN);
  if (fenceOpenIndex === -1) {
    throw new Error('no ```yaml fence found directly after the marker comment');
  }
  const contentStart = fenceOpenIndex + YAML_FENCE_OPEN.length;
  const fenceCloseIndex = afterMarker.indexOf(YAML_FENCE_CLOSE, contentStart);
  if (fenceCloseIndex === -1) {
    throw new Error('unterminated ```yaml fence after the marker comment');
  }
  // +1 to include the trailing newline the closing fence sits on its own
  // line after — drydock.example.yml itself ends in a trailing newline.
  return afterMarker.slice(contentStart, fenceCloseIndex + 1);
}

describe('drydock.example.yml', () => {
  test('is byte-identical to the fenced example on the config file docs page', async () => {
    const [exampleFileText, docsPageText] = await Promise.all([
      readFile(EXAMPLE_FILE_PATH, 'utf-8'),
      readFile(DOCS_PAGE_PATH, 'utf-8'),
    ]);

    expect(extractFencedExample(docsPageText)).toBe(exampleFileText);
  });

  test('parses, flattens and validates through the real loader path', async () => {
    const layer = await loadConfigFile(
      {},
      { defaultPaths: [EXAMPLE_FILE_PATH, `${EXAMPLE_FILE_PATH}.never-created`] },
    );
    expect(Object.keys(layer).length).toBeGreaterThan(0);

    const candidateEnv: Record<string, string | undefined> = {};
    mergeConfigLayers(candidateEnv, layer);
    resolveSecretPlaceholders(candidateEnv);

    const result = await validateConfiguration(candidateEnv);
    expect(result.errors).toStrictEqual([]);
  });
});
