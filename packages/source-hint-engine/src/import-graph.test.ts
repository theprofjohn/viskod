import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildImportGraph, findImporters, findImports } from './import-graph';

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

    writeFileSync(
      join(srcDir, 'page.tsx'),
      'import { Button } from "@/components/ui/button";',
    );
    writeFileSync(
      join(srcDir, 'form.tsx'),
      'import { Button } from "@/components/ui/button";',
    );
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

    writeFileSync(
      join(srcDir, 'page.tsx'),
      'import { Button, Input, Select } from "ui-lib";',
    );

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

  it('handles relative imports (skipped)', () => {
    const tmpDir = join(tmpdir(), `viskod-ig-relative-${Date.now()}`);
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, 'page.tsx'), 'import { X } from "./local";');

    const graph = buildImportGraph(tmpDir, ['src']);
    const pageImports = findImports(graph, 'src/page.tsx');
    // Relative imports are skipped in the current implementation
    expect(pageImports.length).toBe(0);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
