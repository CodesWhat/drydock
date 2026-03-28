import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function compareSemver(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const aPart = aParts[index] ?? 0;
    const bPart = bParts[index] ?? 0;

    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }

  return 0;
}

describe('ui yaml security', () => {
  it('package manifest explicitly pins yaml to the patched version', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      overrides?: Record<string, string>;
    };

    expect(packageJson.overrides?.yaml).toBe('2.8.3');
  });

  it('package lockfile does not resolve vulnerable yaml versions', () => {
    const lockfile = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8')) as {
      packages?: Record<string, { version?: string }>;
    };

    const vulnerableEntries = Object.entries(lockfile.packages ?? {})
      .filter(([path, value]) => path === 'node_modules/yaml' && typeof value.version === 'string')
      .filter(([, value]) => compareSemver(value.version, '2.8.3') < 0);

    expect(vulnerableEntries).toEqual([]);
  });
});
