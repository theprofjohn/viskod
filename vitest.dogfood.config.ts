import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * Dogfood config: runs only the dogfood browser tests against the
 * repo-contained fixture at examples/dogfood-app. Kept separate so `pnpm test`
 * / `pnpm check` still include them and `test:ci` excludes them; a config file
 * avoids shell-glob parsing differences between Windows cmd and POSIX shells.
 */
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['packages/overlay-system/src/dogfood-*.test.ts'],
  },
});
