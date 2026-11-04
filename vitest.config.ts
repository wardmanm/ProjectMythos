import { defineConfig } from 'vitest/config';

// One run covers every package and the repository scripts. spec/ is excluded: the
// reference package runs its own suite through its check script, with aliases only it has.
export default defineConfig({
  test: {
    include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'spec/**'],
  },
});
