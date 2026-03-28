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

describe('ui package lockfile security', () => {
  it('does not pin vulnerable picomatch versions', () => {
    const lockfilePath = join(process.cwd(), 'package-lock.json');
    const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8')) as {
      packages?: Record<string, { version?: string }>;
    };

    const vulnerableEntries = Object.entries(lockfile.packages ?? {})
      .filter(([, value]) => {
        return typeof value.version === 'string' && compareSemver(value.version, '4.0.4') < 0;
      })
      .filter(([path]) => path.includes('picomatch'));

    expect(vulnerableEntries).toEqual([]);
  });
});
