import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vite requires a default export here (CONV-005). The root vitest.config.ts runs this file
// as the client's test project.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The `@/` alias comes from tsconfig.json's paths, so it is written once.
  resolve: { tsconfigPaths: true },
  server: {
    proxy: {
      // The server's default port (MachineConfigSchema); the event stream goes through here
      // too. xfwd marks each request as forwarded (X-Forwarded-For), and the PIN lock never
      // exempts a forwarded request as localhost (ARCH-111), so a phone using this dev
      // server still needs the PIN.
      '/api': { target: 'http://localhost:5317', xfwd: true },
    },
  },
  test: {
    name: 'client',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
