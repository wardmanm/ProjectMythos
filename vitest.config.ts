import { defineConfig } from 'vitest/config';

// One run covers every package and the repository scripts. The client is a project of its
// own, from its Vite config, so its tests get jsdom and the `@/` alias. spec/ is excluded:
// the reference package runs its own suite through its check script, with aliases only it has.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['apps/server/**/*.test.ts', 'packages/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'spec/**'],
        },
      },
      'apps/client/vite.config.ts',
    ],
  },
});
