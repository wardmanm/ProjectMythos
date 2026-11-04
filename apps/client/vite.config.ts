import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite requires a default export here (CONV-005).
export default defineConfig({
  plugins: [react()],
});
