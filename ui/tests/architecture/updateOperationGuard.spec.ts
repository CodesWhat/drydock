import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI_SRC_ROOT = resolve(__dirname, '../../src');

// The API payload type still carries `updateOperation` and the operations store
// seeds from it. Everything else reads update progress from the store.
const ALLOWED_FILES = new Set(['utils/container-mapper.ts', 'stores/operations.ts']);

// Any whole-word use: `.updateOperation`, `updateOperation:`, `updateOperation?:`,
// `x['updateOperation']`, and `{ updateOperation }` / `{ updateOperation: op }`
// destructuring. The word boundary leaves names like updateOperationsError alone.
const FIELD_USAGE = /\bupdateOperation\b/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function usesField(source: string): boolean {
  return FIELD_USAGE.test(stripComments(source));
}

describe('update operation architecture guard', () => {
  it.each([
    ['property access', 'const op = container.updateOperation;'],
    ['object key', 'const row = { updateOperation: undefined };'],
    ['optional type field', 'interface Row { updateOperation?: ContainerUpdateOperation }'],
    ['double-quoted bracket access', 'const op = container["updateOperation"];'],
    ['single-quoted bracket access', "const op = container['updateOperation'];"],
    ['destructuring', 'const { updateOperation } = container;'],
    ['renamed destructuring', 'const { updateOperation: op } = container;'],
  ])('flags %s', (_label, source) => {
    expect(usesField(source)).toBe(true);
  });

  it('ignores unrelated identifiers and comments', () => {
    expect(usesField('const e = backups.updateOperationsError;')).toBe(false);
    expect(usesField('// container.updateOperation is gone\nconst a = 1;')).toBe(false);
    expect(usesField('/* updateOperation: x */ const a = 1;')).toBe(false);
  });

  it('keeps the container updateOperation field out of ui/src', () => {
    const offenders = globSync('**/*.{ts,vue}', {
      cwd: UI_SRC_ROOT,
      exclude: ['**/*.d.ts'],
    })
      .filter((file) => !ALLOWED_FILES.has(file))
      .filter((file) => usesField(readFileSync(resolve(UI_SRC_ROOT, file), 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('keeps the field off the UI Container type', () => {
    const containerType = readFileSync(resolve(UI_SRC_ROOT, 'types/container.d.ts'), 'utf8');
    expect(usesField(containerType)).toBe(false);
  });
});
