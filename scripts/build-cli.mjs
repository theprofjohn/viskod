#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Build the distributable @viskod/cli bundle.
 *
 * The source tree runs on tsx with `moduleResolution: "bundler"`, so the
 * compiled tsc output contains extensionless relative imports that plain
 * Node ESM cannot load. For distribution we bundle the CLI (and all of its
 * @viskod/* workspace dependencies plus zod) into a single self-contained
 * ESM file. Playwright stays external — it is a declared runtime dependency
 * and brings its own native driver and browser downloads.
 */
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'packages/cli/src/index.ts');
const outfile = resolve(root, 'packages/cli/dist/index.js');
const cliVersion = JSON.parse(
  readFileSync(resolve(root, 'packages/cli/package.json'), 'utf8'),
).version;

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['playwright', 'pngjs'],
  define: {
    // packages/cli/package.json is the publish authority; the bundled
    // executable must report exactly the version that will be published.
    __VISKOD_VERSION__: JSON.stringify(cliVersion),
  },
  logLevel: 'info',
});

console.log(`Bundled @viskod/cli@${cliVersion} → ${outfile}`);
