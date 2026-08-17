import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkspacePackageMetadata } from '@viskod/shared';
import type { ImportGraphEntry } from './classifier';

const NAMED_IMPORT_PATTERN = /\{([^}]+)\}/;
const DEFAULT_IMPORT_PATTERN = /import\s+(\w+)\s+from/;
const NAMESPACE_IMPORT_PATTERN = /import\s+\*\s+as\s+(\w+)\s+from/;

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'];
const INDEX_SUFFIXES = ['index.tsx', 'index.ts', 'index.jsx', 'index.js', 'index.vue'];

export interface ScanBudget {
  maxFiles: number;
  maxTimeMs: number;
}

/** Default scan budget — Phase 30 latency boundary (finite, bounded). */
export const DEFAULT_SCAN_BUDGET: ScanBudget = { maxFiles: 3000, maxTimeMs: 2500 };

/** Thrown when a scan exceeds its budget; the engine maps it to `unavailable`. */
export class ScanBudgetExceededError extends Error {
  constructor() {
    super('Source scan budget exceeded');
    this.name = 'ScanBudgetExceededError';
  }
}

interface BudgetState {
  files: number;
  startMs: number;
  budget: ScanBudget;
}

function touchBudget(state: BudgetState): void {
  state.files++;
  if (state.files > state.budget.maxFiles || Date.now() - state.startMs > state.budget.maxTimeMs) {
    throw new ScanBudgetExceededError();
  }
}

export function buildImportGraph(
  rootPath: string,
  dirs: string[],
  budget: ScanBudget = DEFAULT_SCAN_BUDGET,
): ImportGraphEntry[] {
  const entries: ImportGraphEntry[] = [];
  const seen = new Set<string>();
  const state: BudgetState = { files: 0, startMs: Date.now(), budget };

  for (const dir of dirs) {
    const dirPath = path.join(rootPath, dir.replace(/\//g, path.sep));
    if (!fs.existsSync(dirPath)) continue;

    walkDirectory(dirPath, rootPath, entries, seen, state);
  }

  return entries;
}

function walkDirectory(
  dirPath: string,
  rootPath: string,
  entries: ImportGraphEntry[],
  seen: Set<string>,
  state: BudgetState,
): void {
  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      if (
        ['node_modules', 'dist', 'build', '.next', '.cache', '.output', 'coverage'].includes(
          item.name,
        )
      ) {
        continue;
      }
      walkDirectory(fullPath, rootPath, entries, seen, state);
      continue;
    }

    if (!item.isFile()) continue;

    const ext = path.extname(item.name).toLowerCase();
    if (!CODE_EXTENSIONS.includes(ext)) continue;

    touchBudget(state);
    const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const fileEntries = parseImports(rootPath, relPath, content);
      entries.push(...fileEntries);
    } catch (error) {
      if (error instanceof ScanBudgetExceededError) throw error;
      // skip unreadable files
    }
  }
}

/** Extract the `from '<spec>'` module specifier of an import line. */
function fromSpecifier(line: string): string | null {
  return line.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? null;
}

/** Extract `const { A, B }` / `const X` binding names for require lines. */
function bindingNames(line: string): string[] | null {
  const destructureMatch = line.match(/const\s+\{([^}]+)\}/);
  if (destructureMatch?.[1]) {
    return destructureMatch[1]
      .split(',')
      .map((n) =>
        n
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim(),
      )
      .filter((n): n is string => Boolean(n));
  }
  const constMatch = line.match(/const\s+(\w+)/);
  return constMatch?.[1] ? [constMatch[1]] : null;
}

function localEntry(
  rootPath: string,
  sourceFile: string,
  spec: string,
  names: string[],
  isDefault: boolean,
): ImportGraphEntry[] {
  const resolved = resolveLocalImport(rootPath, sourceFile, spec);
  const target = resolved ?? spec;
  return names.map((name) => ({
    sourceFile,
    importedFile: target,
    importedName: name,
    isDefault,
    isNamespace: false,
    isLocal: resolved !== null,
  }));
}

function packageEntry(
  sourceFile: string,
  spec: string,
  names: string[],
  isDefault: boolean,
  isNamespace = false,
): ImportGraphEntry[] {
  return names.map((name) => ({
    sourceFile,
    importedFile: spec,
    importedName: name,
    isDefault,
    isNamespace,
  }));
}

function parseImports(rootPath: string, sourceFile: string, content: string): ImportGraphEntry[] {
  const entries: ImportGraphEntry[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // Skip side-effect imports (import 'path')
    if (/^import\s+['"]/.test(trimmed) && !/^import\s+\w/.test(trimmed)) continue;

    // Namespace import: import * as X from 'path'
    const namespaceMatch = trimmed.match(NAMESPACE_IMPORT_PATTERN);
    if (namespaceMatch) {
      const spec = fromSpecifier(trimmed);
      const name = namespaceMatch[1];
      if (spec && name) {
        if (spec.startsWith('.')) {
          entries.push(...localEntry(rootPath, sourceFile, spec, [name], false));
        } else {
          entries.push(...packageEntry(sourceFile, spec, [name], false, true));
        }
      }
      continue;
    }

    // Named imports: import { X, Y } from 'path'
    const namedMatch = trimmed.match(NAMED_IMPORT_PATTERN);
    if (namedMatch) {
      const spec = fromSpecifier(trimmed);
      if (spec && namedMatch[1]) {
        const names = namedMatch[1]
          .split(',')
          .map((n) =>
            n
              .trim()
              .split(/\s+as\s+/)[0]
              ?.trim(),
          )
          .filter((n): n is string => Boolean(n));
        if (names.length > 0) {
          if (spec.startsWith('.')) {
            entries.push(...localEntry(rootPath, sourceFile, spec, names, false));
          } else {
            entries.push(...packageEntry(sourceFile, spec, names, false));
          }
        }
      }
      continue;
    }

    // Default import: import X from 'path'
    const defaultMatch = trimmed.match(DEFAULT_IMPORT_PATTERN);
    if (defaultMatch) {
      const spec = fromSpecifier(trimmed);
      const name = defaultMatch[1];
      if (spec && name) {
        if (spec.startsWith('.')) {
          entries.push(...localEntry(rootPath, sourceFile, spec, [name], true));
        } else {
          entries.push(...packageEntry(sourceFile, spec, [name], true));
        }
      }
      continue;
    }

    // require: const X = require('path') / const { X } = require('path')
    const requireMatch = trimmed.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch) {
      const spec = requireMatch[1];
      const names = bindingNames(trimmed);
      if (spec && names && names.length > 0) {
        if (spec.startsWith('.')) {
          entries.push(...localEntry(rootPath, sourceFile, spec, names, true));
        } else {
          entries.push(...packageEntry(sourceFile, spec, names, true));
        }
      }
    }
  }

  return entries;
}

/**
 * Resolve a relative import specifier from `sourceFile` to a repository-
 * relative file path. Best-effort extension/index resolution; returns null
 * when the target does not exist, escapes the repository root, or is
 * absolute (safety: candidates must never escape the selected project root).
 */
export function resolveLocalImport(
  rootPath: string,
  sourceFile: string,
  spec: string,
): string | null {
  const sourceDir = path.posix.dirname(sourceFile);
  const base = path.posix.normalize(`${sourceDir}/${spec}`);
  if (base.startsWith('..') || path.posix.isAbsolute(base)) return null;

  const candidates: string[] = [base];
  for (const ext of CODE_EXTENSIONS) {
    candidates.push(`${base}${ext}`);
  }
  for (const suffix of INDEX_SUFFIXES) {
    candidates.push(`${base}/${suffix}`);
  }
  for (const ext of CODE_EXTENSIONS) {
    candidates.push(`${base}/index${ext}`);
  }

  for (const candidate of candidates) {
    if (candidate.startsWith('..') || path.posix.isAbsolute(candidate)) continue;
    try {
      if (fs.existsSync(path.join(rootPath, candidate.replace(/\//g, path.sep)))) return candidate;
    } catch {
      // permission error — keep looking
    }
  }
  return null;
}

/**
 * Resolve a module specifier that may be a workspace package import
 * (e.g. `@acme/utils/format`) to a repository-relative file path.
 *
 * Returns null if the specifier is not a workspace package or the
 * target file does not exist.
 */
export function resolveWorkspaceImport(
  rootPath: string,
  sourceFile: string,
  spec: string,
  packages: WorkspacePackageMetadata[],
): string | null {
  // Delegate relative imports to the local resolver
  if (spec.startsWith('.')) return resolveLocalImport(rootPath, sourceFile, spec);

  // Check if spec matches a workspace package
  for (const pkg of packages) {
    const pkgName = pkg.name;
    if (spec === pkgName || spec.startsWith(`${pkgName}/`)) {
      const subpath = spec.slice(pkgName.length + 1) || 'index';
      // Try each sourceRoot in the package
      for (const srcRoot of pkg.sourceRoots) {
        const candidates: string[] = [];
        if (subpath === 'index') {
          // Package root import — look for index files
          for (const ext of CODE_EXTENSIONS) {
            candidates.push(`${srcRoot}/index${ext}`);
          }
        } else {
          // Subpath import — look for the file with code extensions
          const base = `${srcRoot}/${subpath}`;
          candidates.push(base);
          for (const ext of CODE_EXTENSIONS) {
            candidates.push(`${base}${ext}`);
          }
          for (const suffix of INDEX_SUFFIXES) {
            candidates.push(`${base}/${suffix}`);
          }
        }
        for (const candidate of candidates) {
          try {
            if (fs.existsSync(path.join(rootPath, candidate.replace(/\//g, path.sep)))) {
              return candidate;
            }
          } catch {
            // permission error
          }
        }
      }
    }
  }
  return null;
}

/**
 * Repository-relative import closure of `entryFile` (transitively).
 *
 * Walks only local relative imports (never package imports), bounded by the
 * scan budget. Deterministic: BFS in sorted order. Returns the set of
 * repository-relative file paths reachable from the entry file.
 */
export function buildLocalDependencyClosure(
  rootPath: string,
  entryFile: string,
  budget: ScanBudget = DEFAULT_SCAN_BUDGET,
): Set<string> {
  const closure = new Set<string>();
  const queue: string[] = [entryFile];
  const state: BudgetState = { files: 0, startMs: Date.now(), budget };

  while (queue.length > 0) {
    const current = queue.shift() ?? '';
    if (closure.has(current)) continue;
    closure.add(current);
    touchBudget(state);

    let content: string;
    try {
      content = fs.readFileSync(path.join(rootPath, current.replace(/\//g, path.sep)), 'utf-8');
    } catch (error) {
      if (error instanceof ScanBudgetExceededError) throw error;
      continue;
    }

    const entries = parseImports(rootPath, current, content);
    for (const entry of entries) {
      if (entry.isLocal && entry.importedFile && !entry.importedFile.startsWith('.')) {
        const target = entry.importedFile;
        if (target.startsWith('..') || path.posix.isAbsolute(target)) continue;
        if (!closure.has(target)) queue.push(target);
      }
    }
  }

  return closure;
}

/**
 * Build a dependency closure that follows both local relative imports
 * and workspace package imports.
 */
export function buildWorkspaceDependencyClosure(
  rootPath: string,
  entryFile: string,
  packages: WorkspacePackageMetadata[],
  budget: ScanBudget = DEFAULT_SCAN_BUDGET,
): Set<string> {
  const closure = new Set<string>();
  const queue: string[] = [entryFile];
  const state: BudgetState = { files: 0, startMs: Date.now(), budget };

  while (queue.length > 0) {
    const current = queue.shift() ?? '';
    if (closure.has(current)) continue;
    closure.add(current);
    touchBudget(state);

    let content: string;
    try {
      content = fs.readFileSync(path.join(rootPath, current.replace(/\//g, path.sep)), 'utf-8');
    } catch (error) {
      if (error instanceof ScanBudgetExceededError) throw error;
      continue;
    }

    const entries = parseImports(rootPath, current, content);
    for (const entry of entries) {
      let target: string | null = null;
      if (entry.isLocal && entry.importedFile && !entry.importedFile.startsWith('.')) {
        target = entry.importedFile;
      } else if (!entry.isLocal && packages.length > 0) {
        target = resolveWorkspaceImport(rootPath, current, entry.importedFile, packages);
      }
      if (target && !target.startsWith('..') && !path.posix.isAbsolute(target)) {
        if (!closure.has(target)) queue.push(target);
      }
    }
  }

  return closure;
}

export function findImporters(graph: ImportGraphEntry[], targetPackage: string): string[] {
  const importers = new Set<string>();
  for (const entry of graph) {
    if (
      entry.importedFile === targetPackage ||
      entry.importedFile.startsWith(`${targetPackage}/`)
    ) {
      importers.add(entry.sourceFile);
    }
  }
  return Array.from(importers);
}

export function findImports(graph: ImportGraphEntry[], sourceFile: string): ImportGraphEntry[] {
  return graph.filter((e) => e.sourceFile === sourceFile);
}
