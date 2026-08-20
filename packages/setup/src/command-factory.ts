import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export type RuntimeMode = 'installed' | 'dev';

export interface McpServeCommand {
  command: string;
  args: string[];
  mode: RuntimeMode;
  source: string;
}

/**
 * True when `candidate` is the root of a Viskod source checkout: the CLI
 * entry exists at packages/cli/src/index.ts AND the root package.json is
 * named 'viskod'. This mirrors the detection cmdInstall uses today.
 */
function isViskodCheckoutRoot(candidate: string): boolean {
  try {
    const cliEntry = path.join(candidate, 'packages', 'cli', 'src', 'index.ts');
    const pkgPath = path.join(candidate, 'package.json');
    if (!fs.existsSync(cliEntry) || !fs.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { name?: unknown };
    return pkg.name === 'viskod';
  } catch {
    return false;
  }
}

/**
 * Walks up from `startDir` (default: this module's directory, i.e. the setup
 * package) looking for the Viskod checkout root. Returns null when no
 * checkout is found — meaning the code runs installed.
 */
export function findViskodCheckoutRoot(startDir?: string): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  let dir = startDir ?? moduleDir;
  const visited = new Set<string>();

  while (dir && !visited.has(dir)) {
    visited.add(dir);
    if (isViskodCheckoutRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Runtime mode of this @viskod/setup instance. 'dev' iff a Viskod checkout is
 * detectable from the module location (with `cwd` as a fallback start
 * point); otherwise 'installed'.
 */
export function detectRuntimeMode(opts?: { cwd?: string }): RuntimeMode {
  if (findViskodCheckoutRoot() !== null) return 'dev';
  if (opts?.cwd !== undefined && findViskodCheckoutRoot(opts.cwd) !== null) return 'dev';
  return 'installed';
}

/**
 * Resolves the executable the MCP client should spawn.
 *
 * Installed mode: `import.meta.url` IS the CLI bundle entry when bundled.
 * When running unbundled with a forced installed mode, resolve the
 * @viskod/cli dist via require.resolve, falling back to this module's URL.
 */
function getInstalledEntry(): string {
  const ownUrl = fileURLToPath(import.meta.url);
  try {
    const require = createRequire(import.meta.url);
    return require.resolve('@viskod/cli/dist/index.js');
  } catch {
    return ownUrl;
  }
}

/**
 * Builds the MCP serve command for the current runtime mode.
 *
 * - installed: `process.execPath <cli-bundle-entry> serve ...`
 * - dev: `npx tsx <checkout>/packages/cli/src/index.ts serve ...`
 *
 * `--url` / `--project-root` are appended ONLY when explicitly provided
 * (there is no default URL).
 */
export function getMcpServeCommand(opts?: {
  mode?: RuntimeMode | 'auto';
  cwd?: string;
  projectRoot?: string;
  url?: string;
}): McpServeCommand {
  const mode =
    opts?.mode === undefined || opts.mode === 'auto'
      ? detectRuntimeMode({ cwd: opts?.cwd })
      : opts.mode;

  const extraArgs: string[] = [];
  if (opts?.url !== undefined) {
    extraArgs.push('--url', opts.url);
  }
  if (opts?.projectRoot !== undefined) {
    extraArgs.push('--project-root', opts.projectRoot);
  }

  if (mode === 'dev') {
    const checkoutRoot = findViskodCheckoutRoot() ?? findViskodCheckoutRoot(opts?.cwd);
    if (!checkoutRoot) {
      throw new Error('dev mode requested but no Viskod source checkout was located');
    }
    return {
      command: 'npx',
      args: [
        'tsx',
        path.join(checkoutRoot, 'packages', 'cli', 'src', 'index.ts'),
        'serve',
        ...extraArgs,
      ],
      mode: 'dev',
      source: 'source-checkout',
    };
  }

  return {
    command: process.execPath,
    args: [getInstalledEntry(), 'serve', ...extraArgs],
    mode: 'installed',
    source: 'installed-cli',
  };
}
