import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dogfood fixture: a small shadcn-admin-style React app that the dogfood
 * tests (packages/overlay-system/src/dogfood-*.test.ts) run against. It must
 * serve on http://localhost:5173 and expose the generic UI surface those
 * tests exercise: sidebar nav links, icon buttons, inputs, a select, tables,
 * cards, and multiple routes.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
