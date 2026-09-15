import { configDefaults } from 'vitest/config';

import config from './vitest.config.mjs';

test('workflow discovery excludes parked worktrees and preserves Vitest defaults', () => {
  expect(config.test.exclude).toEqual(
    expect.arrayContaining([...configDefaults.exclude, '**/.claude/**', '**/.codex/**']),
  );
});
