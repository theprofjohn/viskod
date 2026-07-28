import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const resolveAlias = {
  '@viskod/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
  '@viskod/event-bus': resolve(__dirname, 'packages/event-bus/src/index.ts'),
  '@viskod/config': resolve(__dirname, 'packages/config/src/index.ts'),
  '@viskod/capture-pipeline': resolve(__dirname, 'packages/capture-pipeline/src/index.ts'),
  '@viskod/browser-runtime': resolve(__dirname, 'packages/browser-runtime/src/index.ts'),
  '@viskod/context-engine': resolve(__dirname, 'packages/context-engine/src/index.ts'),
  '@viskod/overlay-system': resolve(__dirname, 'packages/overlay-system/src/index.ts'),
};

export default defineConfig({
  resolve: {
    alias: resolveAlias,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
