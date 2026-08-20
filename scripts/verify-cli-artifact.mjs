#!/usr/bin/env node
/**
 * Verify the distributable @viskod/cli artifact.
 *
 * Runs the package-manager pack for @viskod/cli into a temporary directory
 * (prepack rebuilds the bundle), then fails unless:
 *   - the packed package name is `@viskod/cli` and its version equals
 *   - the packed package contains both CLI and packaged Studio entrypoints,
 *   - no repository source paths, `.viskod` data, test files, or secret-looking
 *     environment files leak into the tarball or bundled runtime.
 *
 * The temporary directory is always removed; cleanup failure also fails the
 * command. Missing output, pack failure, and malformed metadata are errors —
 * there is no warning-only mode.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLI_PACKAGE_JSON = resolve(ROOT, 'packages/cli/package.json');

const problems = [];
const tmp = mkdtempSync(join(tmpdir(), 'viskod-artifact-'));

try {
  let expected = null;
  try {
    expected = JSON.parse(readFileSync(CLI_PACKAGE_JSON, 'utf8'));
  } catch (error) {
    problems.push(`cannot read ${CLI_PACKAGE_JSON}: ${error.message}`);
  }
  const expectedVersion =
    expected && typeof expected.version === 'string' ? expected.version : null;
  if (!expectedVersion) problems.push(`missing or invalid version in ${CLI_PACKAGE_JSON}`);

  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

  // Pack into the temp dir. prepack rebuilds the bundle, so the tarball is
  // produced from the current source, not a stale dist. Run from the package
  // directory: `pnpm pack` rejects --filter (recursive-mode parse error), so
  // use pnpm's --dir instead of cwd-hopping.
  try {
    const packOut = execFileSync(
      pnpm,
      ['--dir', 'packages/cli', 'pack', '--pack-destination', tmp],
      {
        cwd: ROOT,
        encoding: 'utf8',
        // Windows: pnpm.cmd is a batch script and must run through the shell.
        shell: process.platform === 'win32',
      },
    );
    process.stdout.write(packOut);
  } catch (error) {
    problems.push(`pnpm pack failed: ${error.message}`);
  }

  const tarballs = readdirSync(tmp).filter((f) => f.endsWith('.tgz'));
  if (tarballs.length === 0) {
    problems.push('pnpm pack produced no .tgz output');
  } else {
    const tarball = join(tmp, tarballs[0]);
    console.log(`[verify-cli-artifact] packed artifact: ${tarballs[0]}`);

    let files = [];
    try {
      const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
      files = listing.split(/\r?\n/).filter((e) => e && !e.endsWith('/'));
    } catch (error) {
      problems.push(`cannot list tarball entries: ${error.message}`);
    }

    const FORBIDDEN_ENTRY = [
      { re: /(^|\/)\.viskod(\/|$)/, label: '.viskod data' },
      { re: /(^|\/)\.env([^/]*)(\/|$)/, label: 'environment files' },
      { re: /\.(pem|key|p12|pfx)$/i, label: 'secret/key files' },
      { re: /(^|\/)\.npmrc(\/|$)/, label: 'npm config (may embed tokens)' },
      { re: /dogfood/i, label: 'dogfood test files' },
      { re: /\.test\.[cm]?[jt]sx?$|(^|\/)tests?(\/|$)/, label: 'test files' },
    ];
    const ALLOWED_EXTRA = new Set(['package/package.json', 'package/README.md', 'package/LICENSE']);

    for (const entry of files) {
      for (const { re, label } of FORBIDDEN_ENTRY) {
        if (re.test(entry)) problems.push(`tarball contains forbidden ${label}: ${entry}`);
      }
      if (
        entry !== 'package/dist/index.js' &&
        entry !== 'package/dist/studio.js' &&
        !entry.startsWith('package/dist/') &&
        !ALLOWED_EXTRA.has(entry)
      ) {
        problems.push(`unexpected content in tarball: ${entry}`);
      }
    }

    for (const required of ['package/dist/index.js', 'package/dist/studio.js']) {
      if (!files.includes(required)) problems.push(`tarball is missing ${required}`);
    }

    if (expectedVersion) {
      try {
        const unpack = join(tmp, 'unpack');
        mkdirSync(unpack, { recursive: true });
        execFileSync(
          'tar',
          [
            '-xzf',
            tarball,
            '-C',
            unpack,
            'package/package.json',
            'package/dist/index.js',
            'package/dist/studio.js',
          ],
          { stdio: 'ignore' },
        );
        const metadata = JSON.parse(readFileSync(join(unpack, 'package/package.json'), 'utf8'));
        if (metadata.name !== '@viskod/cli') {
          problems.push(`packed package name is "${metadata.name}", expected "@viskod/cli"`);
        }
        if (metadata.version !== expectedVersion) {
          problems.push(
            `packed package version is "${metadata.version}", expected "${expectedVersion}"`,
          );
        }
        for (const runtime of ['index.js', 'studio.js']) {
          const code = readFileSync(join(unpack, 'package/dist', runtime), 'utf8');
          for (const needle of [
            'apps/studio/src',
            'packages/cli/src',
            'pnpm exec tsx',
            '/home/john/Projects/Viskod',
            'C:/Viskod',
          ]) {
            if (code.includes(needle)) {
              problems.push(`dist/${runtime} contains repository-local string "${needle}"`);
            }
          }
        }
      } catch (error) {
        problems.push(`cannot inspect packed metadata/entrypoints: ${error.message}`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      `[verify-cli-artifact] FAIL (${problems.length} problem${problems.length === 1 ? '' : 's'}):`,
    );
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log(
      `[verify-cli-artifact] OK: @viskod/cli@${expectedVersion ?? 'unknown'} artifact verified`,
    );
  }
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch (error) {
    console.error(
      `[verify-cli-artifact] failed to clean up temporary directory ${tmp}: ${error.message}`,
    );
    process.exitCode = 1;
  }
}
