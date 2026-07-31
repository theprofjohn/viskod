import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ImportGraphEntry } from './classifier';

const IMPORT_PATTERNS = [
  // import { X } from 'path'
  /import\s+(?:\{[^}]+\}|[\w*]+)\s+from\s+['"]([^'"]+)['"]/g,
  // import X from 'path'
  /import\s+[\w*]+\s+from\s+['"]([^'"]+)['"]/g,
  // const { X } = require('path')
  /const\s+\{[^}]+\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // const X = require('path')
  /const\s+[\w*]+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // import 'path' (side effect)
  /import\s+['"]([^'"]+)['"]/g,
];

const NAMED_IMPORT_PATTERN = /\{([^}]+)\}/;
const DEFAULT_IMPORT_PATTERN = /import\s+(\w+)\s+from/;
const NAMESPACE_IMPORT_PATTERN = /import\s+\*\s+as\s+(\w+)\s+from/;

export function buildImportGraph(rootPath: string, dirs: string[]): ImportGraphEntry[] {
  const entries: ImportGraphEntry[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    const dirPath = path.join(rootPath, dir.replace(/\//g, path.sep));
    if (!fs.existsSync(dirPath)) continue;

    walkDirectory(dirPath, rootPath, entries, seen);
  }

  return entries;
}

function walkDirectory(
  dirPath: string,
  rootPath: string,
  entries: ImportGraphEntry[],
  seen: Set<string>,
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
      if (['node_modules', 'dist', 'build', '.next', '.cache'].includes(item.name)) continue;
      walkDirectory(fullPath, rootPath, entries, seen);
      continue;
    }

    if (!item.isFile()) continue;

    const ext = path.extname(item.name).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'].includes(ext)) continue;

    const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const fileEntries = parseImports(relPath, content);
      entries.push(...fileEntries);
    } catch {
      // skip unreadable files
    }
  }
}

function parseImports(sourceFile: string, content: string): ImportGraphEntry[] {
  const entries: ImportGraphEntry[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // Skip side-effect imports (import 'path')
    if (/^import\s+['"]/.test(trimmed) && !/^import\s+\w/.test(trimmed)) continue;

    // Check for namespace import first
    const namespaceMatch = trimmed.match(NAMESPACE_IMPORT_PATTERN);
    if (namespaceMatch) {
      const pathMatch = trimmed.match(/from\s+['"]([^'"]+)['"]/);
      if (pathMatch && !pathMatch[1]?.startsWith('.')) {
        entries.push({
          sourceFile,
          importedFile: pathMatch[1]!,
          importedName: namespaceMatch[1]!,
          isDefault: false,
          isNamespace: true,
        });
      }
      continue;
    }

    // Check for named imports: import { X, Y } from 'path'
    const namedMatch = trimmed.match(NAMED_IMPORT_PATTERN);
    if (namedMatch) {
      const pathMatch = trimmed.match(/from\s+['"]([^'"]+)['"]/);
      if (pathMatch && !pathMatch[1]?.startsWith('.')) {
        const names = namedMatch[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]!.trim());
        for (const name of names) {
          if (name) {
            entries.push({
              sourceFile,
              importedFile: pathMatch[1]!,
              importedName: name,
              isDefault: false,
              isNamespace: false,
            });
          }
        }
      }
      continue;
    }

    // Check for default import: import X from 'path'
    const defaultMatch = trimmed.match(DEFAULT_IMPORT_PATTERN);
    if (defaultMatch) {
      const pathMatch = trimmed.match(/from\s+['"]([^'"]+)['"]/);
      if (pathMatch && !pathMatch[1]?.startsWith('.')) {
        entries.push({
          sourceFile,
          importedFile: pathMatch[1]!,
          importedName: defaultMatch[1]!,
          isDefault: true,
          isNamespace: false,
        });
      }
      continue;
    }

    // Check for require: const X = require('path') or const { X } = require('path')
    const requireMatch = trimmed.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch && !requireMatch[1]?.startsWith('.')) {
      const destructureMatch = trimmed.match(/const\s+\{([^}]+)\}/);
      if (destructureMatch) {
        const names = destructureMatch[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]!.trim());
        for (const name of names) {
          if (name) {
            entries.push({
              sourceFile,
              importedFile: requireMatch[1]!,
              importedName: name,
              isDefault: false,
              isNamespace: false,
            });
          }
        }
      } else {
        const constMatch = trimmed.match(/const\s+(\w+)/);
        if (constMatch) {
          entries.push({
            sourceFile,
            importedFile: requireMatch[1]!,
            importedName: constMatch[1]!,
            isDefault: true,
            isNamespace: false,
          });
        }
      }
    }
  }

  return entries;
}

export function findImporters(
  graph: ImportGraphEntry[],
  targetPackage: string,
): string[] {
  const importers = new Set<string>();
  for (const entry of graph) {
    if (entry.importedFile === targetPackage || entry.importedFile.startsWith(`${targetPackage}/`)) {
      importers.add(entry.sourceFile);
    }
  }
  return Array.from(importers);
}

export function findImports(
  graph: ImportGraphEntry[],
  sourceFile: string,
): ImportGraphEntry[] {
  return graph.filter((e) => e.sourceFile === sourceFile);
}
