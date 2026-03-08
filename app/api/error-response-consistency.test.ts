import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const API_ROOT = path.resolve(__dirname);

const TARGET_FILES = [
  'container/crud.ts',
  'container/logs.ts',
  'container/triggers.ts',
  'notification.ts',
  'settings.ts',
  'helpers.ts',
  'sse.ts',
] as const;

const DIRECT_ERROR_JSON_PATTERN =
  /res\.status\([^)]*\)\.json\(\s*\{\s*(error|message)\s*:|res\.json\(\s*\{\s*(error|message)\s*:/gms;

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

describe('error response consistency', () => {
  test('targeted API modules should route error payloads through sendErrorResponse', () => {
    const offenders: string[] = [];

    for (const relativePath of TARGET_FILES) {
      const absolutePath = path.join(API_ROOT, relativePath);
      const source = fs.readFileSync(absolutePath, 'utf8');

      for (const match of source.matchAll(DIRECT_ERROR_JSON_PATTERN)) {
        const line = getLineNumber(source, match.index ?? 0);
        offenders.push(`${relativePath}:${line}`);
      }
    }

    expect(offenders).toStrictEqual([]);
  });
});
