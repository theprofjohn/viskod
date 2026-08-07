import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * E2E config: runs tests/e2e/*.test.ts only. These tests spawn the fixture
 * server and the Studio (Playwright Chromium) themselves and are excluded
 * from the default `pnpm check` suite on purpose.
 */
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
