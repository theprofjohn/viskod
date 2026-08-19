import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildImportGraph,
  buildLocalDependencyClosure,
  findImporters,
  findImports,
} from './import-graph';

describe('import-graph', () => {
  it('builds import graph from project files', () => {
    const tmpDir = join(tmpdir(), `viskod-ig-test-${Date.now()}`);
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(
      join(srcDir, 'page.tsx'),
      'import { Button } from "@/components/ui/button";\nimport { Card } from "@/components/card";',
    );
    writeFileSync(join(srcDir, 'button.tsx'), 'export function Button() {}');
    writeFileSync(join(srcDir, 'card.tsx'), 'export function Card() {}');

    const graph = buildImportGraph(tmpDir, ['src']);
    expect(graph.length).toBeGreaterThan(0);

    const pageImports = findImports(graph, 'src/page.tsx');
    expect(pageImports.length).toBe(2);
    expect(pageImports[0]?.importedFile).toBe('@/components/ui/button');
    expect(pageImports[1]?.importedFile).toBe('@/components/card');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds importers of a package', () => {
    const tmpDir = join(tmpdir(), `viskod-ig-importers-${Date.now()}`);
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, 'page.tsx'), 'import { Button } from "@/components/ui/button";');
    writeFileSync(join(srcDir, 'form.tsx'), 'import { Button } from "@/components/ui/button";');
    writeFileSync(join(srcDir, 'other.tsx'), 'import { Card } from "@/components/card";');

    const graph = buildImportGraph(tmpDir, ['src']);
    const importers = findImporters(graph, '@/components/ui/button');
    expect(importers.length).toBe(2);
    expect(importers).toContain('src/page.tsx');
    expect(importers).toContain('src/form.tsx');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips node_modules and dist directories', () => {
    const tmpDir = join(tmpdir(), `viskod-ig-skip-${Date.now()}`);
    const srcDir = join(tmpDir, 'src');
    const nmDir = join(tmpDir, 'node_modules');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(nmDir, { recursive: true });

    writeFileSync(join(srcDir, 'page.tsx'), 'import { X } from "lib";');
    writeFileSync(join(nmDir, 'lib.ts'), 'export const X = 1;');

    const graph = buildImportGraph(tmpDir, ['src', 'node_modules']);
    const libImports = graph.filter((e) => e.sourceFile.includes('lib.ts'));
    expect(libImports.length).toBe(0);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles named imports correctly', () => {
    const tmpDir = join(tmpdir(), `viskod-ig-named-${Date.now()}`);
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, 'page.tsx'), 'import { Button, Input, Select } from "ui-lib";');

    const graph = buildImportGraph(tmpDir, ['src']);
    const pageImports = findImports(graph, 'src/page.tsx');
    expect(pageImports.length).toBe(3);
    expect(pageImports.map((e) => e.importedName).sort()).toEqual(['Button', 'Input', 'Select']);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles default imports', () => {
    const tmpDir = join(tmpdir(), `viskod-ig-default-${Date.now()}`);
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, 'page.tsx'), 'import MyComponent from "my-lib";');

    const graph = buildImportGraph(tmpDir, ['src']);
    const pageImports = findImports(graph, 'src/page.tsx');
    expect(pageImports.length).toBe(1);
    expect(pageImports[0]?.isDefault).toBe(true);
    expect(pageImports[0]?.importedName).toBe('MyComponent');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty graph for non-existent directories', () => {
    const graph = buildImportGraph('/nonexistent', ['src']);
    expect(graph.length).toBe(0);
  });

  it('resolves relative imports to repository-relative local files (Phase 30)', () => {
    const tmpDir = join(tmpdir(), `viskod-ig-relative-${Date.now()}`);
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, 'page.tsx'), 'import { X } from "./local";');
    writeFileSync(join(srcDir, 'local.tsx'), 'export const X = 1;');

    const graph = buildImportGraph(tmpDir, ['src']);
    const pageImports = findImports(graph, 'src/page.tsx');
    expect(pageImports.length).toBe(1);
    expect(pageImports[0]?.isLocal).toBe(true);
    expect(pageImports[0]?.importedFile).toBe('src/local.tsx');
    expect(pageImports[0]?.importedName).toBe('X');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds the transitive local import closure of an entry file', () => {
    const tmpDir = join(tmpdir(), `viskod-ig-closure-${Date.now()}`);
    const srcDir = join(tmpDir, 'src');
    mkdirSync(join(srcDir, 'components'), { recursive: true });

    writeFileSync(join(srcDir, 'page.tsx'), 'import { Card } from "./components/Card";');
    writeFileSync(join(srcDir, 'components', 'Card.tsx'), 'import { Button } from "./Button";');
    writeFileSync(join(srcDir, 'components', 'Button.tsx'), 'export function Button() {}');

    const closure = buildLocalDependencyClosure(tmpDir, 'src/page.tsx');
    expect(closure.has('src/page.tsx')).toBe(true);
    expect(closure.has('src/components/Card.tsx')).toBe(true);
    expect(closure.has('src/components/Button.tsx')).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('follows Next-style @/ aliases in local dependency closure', () => {
    const tmpDir = join(tmpdir(), `viskod-ig-alias-${Date.now()}`);
    mkdirSync(join(tmpDir, 'app'), { recursive: true });
    mkdirSync(join(tmpDir, 'components'), { recursive: true });

    writeFileSync(
      join(tmpDir, 'app', 'page.tsx'),
      'import { HomeSearch } from "@/components/home-search";',
    );
    writeFileSync(join(tmpDir, 'components', 'home-search.tsx'), 'export function HomeSearch() {}');

    const closure = buildLocalDependencyClosure(tmpDir, 'app/page.tsx');
    expect(closure).toContain('components/home-search.tsx');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('never lets a relative import escape the repository root', () => {
    const tmpDir = join(tmpdir(), `viskod-ig-escape-${Date.now()}`);
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, 'page.tsx'), 'import { X } from "../../../../etc/passwd";');
    writeFileSync(join(srcDir, 'local.tsx'), 'export const X = 1;');

    const graph = buildImportGraph(tmpDir, ['src']);
    const pageImports = findImports(graph, 'src/page.tsx');
    // Escaping imports must not resolve to files outside the root.
    expect(pageImports.length).toBe(1);
    expect(pageImports[0]?.isLocal).toBe(false);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
