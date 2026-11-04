import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '@mythos/contracts/content', replacement: here('./contracts/content/index.ts') },
      { find: '@mythos/contracts', replacement: here('./contracts/index.ts') },
    ],
  },
  test: { include: ['**/*.test.ts'], exclude: ['node_modules/**'] },
});
