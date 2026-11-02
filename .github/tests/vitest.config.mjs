import { configDefaults } from 'vitest/config';

export default {
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    // Without an include, running this config from the repo root with no path
    // argument collects every spec in the repo (app, ui, e2e, apps/web).
    include: ['.github/tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    // Preserved git worktrees live under .claude/worktrees/ (and legacy
    // .codex/worktrees/) inside the repo; without this exclude, `vitest run
    // .github/tests` from the primary checkout also discovers every nested
    // worktree's copy of the suite, so a parked WIP worktree can fail the
    // pre-push hook for unrelated pushes.
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/.codex/**'],
  },
};
