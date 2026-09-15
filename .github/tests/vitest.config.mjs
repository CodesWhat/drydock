import { configDefaults } from 'vitest/config';

export default {
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    // Match the newer release lines: parked worktrees are separate checkouts,
    // not additional copies of this branch's workflow suite.
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/.codex/**'],
  },
};
