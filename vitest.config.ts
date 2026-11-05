import { configDefaults, defineConfig } from 'vitest/config';

// One run covers every package and the repository scripts. The client is a project of its
// own, from its Vite config, so its tests get jsdom and the `@/` alias. spec/ is excluded:
// the reference package runs its own suite through its check script, with aliases only it
// has. So is .claude/worktrees/, where each parallel agent's copy of the repository runs
// its own tests (02-conventions Decisions).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'spec/**', '.claude/worktrees/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['apps/server/**/*.test.ts', 'packages/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      'apps/client/vite.config.ts',
    ],
  },
});
