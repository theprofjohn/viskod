import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * CI/release gate config: the deterministic, clean-checkout suite. Excludes
 * the dogfood browser tests, which require an external fixture server that CI
 * and release environments do not run. Kept separate from the base config so
 * `pnpm test` / `pnpm check` still run dogfood tests locally.
 *
 * `exclude` replaces vitest's defaults when set, so the default exclusions
 * are repeated explicitly (mirrors vitest 2.x configDefaults.exclude).
 */
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      '**/dogfood*.test.ts',
    ],
  },
});
