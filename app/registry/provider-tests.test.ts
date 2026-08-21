/**
 * Structural guard for the dynamic component-registry convention.
 *
 * Provider classes under `*​/providers/<provider>/` are loaded through a
 * runtime-constructed `import()` call (see `resolveComponentModuleSpecifier`
 * in ./component-resolution.ts and `registerComponent` in ./index.ts), so
 * static analysis tools like knip cannot trace that dynamic import path back
 * to the provider files. Today those files only survive knip's dead-code
 * check because each one has a colocated `<Provider>.test.ts` that knip's
 * vitest plugin treats as an entry point -- that's an accident of test
 * coverage, not a structural guarantee. `knip.json`'s `entry` array now also
 * lists each current provider class file explicitly, closing that gap for
 * the providers that exist today.
 *
 * This test closes the gap for providers added in the future: it makes the
 * project's own convention -- "every provider ships a colocated test" --
 * structurally enforced instead of incidental, by failing if any provider
 * directory is missing the `.test.ts` file for its provider class file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import capitalize from 'capitalize';

const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const PROVIDER_ROOTS = [
  'registries/providers',
  'triggers/providers',
  'watchers/providers',
  'authentications/providers',
];

/**
 * Resolves the provider class file for a given provider directory, mirroring
 * the runtime resolution convention in `registry/index.ts`: prefer
 * `<Capitalize(dir)>.ts`, falling back to the lowercase `<dir>.ts`.
 * Returns `null` when neither exists, meaning the directory isn't a provider
 * entry directory at all (e.g. a `shared/` helpers directory).
 */
function resolveProviderClassFile(rootPath: string, dir: string): string | null {
  const filesInDir = fs.readdirSync(path.join(rootPath, dir));
  const capitalizedName = `${capitalize(dir)}.ts`;
  const lowercaseName = `${dir}.ts`;

  if (filesInDir.includes(capitalizedName)) {
    return capitalizedName;
  }
  if (filesInDir.includes(lowercaseName)) {
    return lowercaseName;
  }
  return null;
}

describe('provider directory convention', () => {
  test('every provider class file has a colocated .test.ts', () => {
    const missing: string[] = [];
    let providerDirectoriesChecked = 0;

    for (const root of PROVIDER_ROOTS) {
      const rootPath = path.join(APP_ROOT, root);
      const dirs = fs
        .readdirSync(rootPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      for (const dir of dirs) {
        const providerClassFile = resolveProviderClassFile(rootPath, dir);
        if (!providerClassFile) {
          // Not a provider entry directory (e.g. registries/providers/shared)
          // -- just colocated helpers, nothing to enforce here.
          continue;
        }

        providerDirectoriesChecked += 1;
        const testFile = providerClassFile.replace(/\.ts$/, '.test.ts');
        if (!fs.existsSync(path.join(rootPath, dir, testFile))) {
          missing.push(path.join(root, dir, testFile));
        }
      }
    }

    // Guard against the root paths silently resolving to nothing (e.g. a
    // typo), which would make the assertion below vacuously pass.
    expect(providerDirectoriesChecked).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
