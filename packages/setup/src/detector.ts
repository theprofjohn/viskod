import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Result } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';
import { VISKOD_STORAGE_DIR } from '@viskod/shared';
import type { ProjectDetectionResult } from './types';

function setupError(code: string, message: string) {
  return {
    code,
    category: ErrorCategory.CONFIGURATION,
    severity: ErrorSeverity.RECOVERABLE,
    message,
    correlationId: crypto.randomUUID(),
    subsystem: 'setup',
    timestamp: new Date().toISOString(),
  };
}

function computeFingerprint(rootPath: string): string {
  const raw = `viskod:${rootPath}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function discoverProjectRoot(startDir?: string): string | null {
  let dir = startDir ?? process.cwd();
  const visited = new Set<string>();

  while (dir && !visited.has(dir)) {
    visited.add(dir);
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function detectPackageManager(rootPath: string): string | undefined {
  if (fs.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(rootPath, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(path.join(rootPath, 'yarn.lock'))) return 'yarn';
  if (
    fs.existsSync(path.join(rootPath, 'bun.lock')) ||
    fs.existsSync(path.join(rootPath, 'bun.lockb'))
  )
    return 'bun';
  return undefined;
}

function detectFramework(rootPath: string): string | undefined {
  const pkgJsonPath = path.join(rootPath, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return undefined;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps.next) return 'next.js';
    if (deps.nuxt) return 'nuxt';
    if (deps['@sveltejs/kit'] || deps.svelte) return 'sveltekit';
    if (deps['@angular/core']) return 'angular';
    if (deps.vue && deps['vue-router']) return 'vue';
    if (deps['react-router'] || deps['react-router-dom']) return 'react-router';
    if (deps.react) return 'react';
    if (deps['solid-js']) return 'solid';
    if (deps.astro) return 'astro';
    if (deps.qwik) return 'qwik';
    if (deps.remix || deps['@remix-run/react']) return 'remix';
  } catch {
    // ignore parse errors
  }
  return undefined;
}

function detectWorkspaceType(rootPath: string): string | undefined {
  if (fs.existsSync(path.join(rootPath, 'pnpm-workspace.yaml'))) return 'pnpm-workspace';
  if (fs.existsSync(path.join(rootPath, 'turbo.json'))) return 'turborepo';
  if (fs.existsSync(path.join(rootPath, 'nx.json'))) return 'nx';
  if (fs.existsSync(path.join(rootPath, 'lerna.json'))) return 'lerna';
  if (fs.existsSync(path.join(rootPath, 'rush.json'))) return 'rush';
  return undefined;
}

export function detectProject(input?: { projectRoot?: string }): Result<ProjectDetectionResult> {
  const rootPath = input?.projectRoot ?? discoverProjectRoot();

  if (!rootPath || !fs.existsSync(rootPath)) {
    return err(
      setupError(
        'SETUP_PROJECT_NOT_FOUND',
        'Could not detect a project root. Ensure you are inside a project directory with a package.json.',
      ),
    );
  }

  const pkgJsonPath = path.join(rootPath, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    return err(
      setupError(
        'SETUP_PROJECT_NOT_FOUND',
        `No package.json found in ${rootPath}. Select a valid project folder.`,
      ),
    );
  }

  let name = 'unknown';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    name = pkg.name ?? path.basename(rootPath);
  } catch {
    name = path.basename(rootPath);
  }

  const hasExistingViskodDir = fs.existsSync(path.join(rootPath, VISKOD_STORAGE_DIR));

  return ok({
    rootPath,
    rootDisplayName: path.basename(rootPath),
    rootFingerprint: computeFingerprint(rootPath),
    name,
    packageManager: detectPackageManager(rootPath),
    framework: detectFramework(rootPath),
    workspaceType: detectWorkspaceType(rootPath),
    hasExistingViskodDir,
  });
}
