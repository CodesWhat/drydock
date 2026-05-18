/**
 * Vitest config used exclusively by Stryker mutation testing.
 *
 * Stryker copies `ui/` source files into a sandbox directory (under
 * `.stryker-tmp/`) and sets the worker-process cwd to that sandbox.
 * Two test files cannot run in that environment:
 *
 * 1. tests/vitest.coverage-provider.spec.ts — imports the custom coverage
 *    provider (`../vitest.coverage-provider.js`) which in turn does a
 *    cross-workspace import (`../app/vitest.coverage-provider.shared.js`).
 *    The sandbox only contains `ui/` files, so `../app/` does not exist
 *    relative to the sandbox root, causing "Failed to resolve import".
 *
 * 2. tests/boot/crowdin-config.spec.ts — resolves the repo root via
 *    `resolve(import.meta.dirname, '../../..')` and reads `crowdin.yml` /
 *    `.github/workflows/i18n-crowdin.yml`.  Inside the sandbox that path
 *    lands at `.stryker-tmp/`, not the actual repo root, so the files are
 *    missing.
 *
 * Both tests are purely infrastructure/config validation — they do not cover
 * application source code, so excluding them here does not hide any mutants.
 * The real `vitest.config.ts` (used by `npm run test:unit`) is unchanged.
 */

import { mergeConfig } from 'vitest/config';
import vitestConfig from './vitest.config';

export default mergeConfig(vitestConfig, {
  test: {
    exclude: ['tests/vitest.coverage-provider.spec.ts', 'tests/boot/crowdin-config.spec.ts'],
  },
});
