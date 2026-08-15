import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * E2E config: runs tests/e2e/*.test.ts only. These tests spawn the fixture
 * server and the Studio (Playwright Chromium) themselves and are excluded
 * from the default `pnpm check` suite on purpose.
 *
 * `fileParallelism: false` sequences the files: each file owns Studio on the
 * fixed port 3001 and the fixture on 3000, so parallel files would collide.
 * Deterministic sequencing is the contract — no dynamic port selection.
 */
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['tests/e2e/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
