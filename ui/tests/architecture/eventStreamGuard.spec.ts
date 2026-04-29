import { globSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI_SRC_ROOT = resolve(__dirname, '../../src');
const EVENT_STREAM_STORE = 'stores/eventStream.ts';

describe('event stream architecture guard', () => {
  it('keeps EventSource construction centralized in the event stream store', () => {
    const offenders = globSync('**/*.{ts,vue}', {
      cwd: UI_SRC_ROOT,
      exclude: ['**/*.d.ts'],
    }).filter((file) => {
      if (file === EVENT_STREAM_STORE) {
        return false;
      }
      return readFileSync(resolve(UI_SRC_ROOT, file), 'utf8').includes('new EventSource');
    });

    expect(offenders.map((file) => relative(UI_SRC_ROOT, resolve(UI_SRC_ROOT, file)))).toEqual([]);
  });
});
