import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { describe, expect, it } from 'vitest';
import { ProjectScanner } from './index';

describe('ProjectScanner', () => {
  it('scans current directory and returns configuration', async () => {
    const bus = new EventBus();
    const scanner = new ProjectScanner(bus);
    const result = await scanner.scan();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata.name).toBe('viskod');
      expect(result.value.configuration.length).toBeGreaterThan(0);
      // Config entries include both existing and non-existing files
      // Each has an `exists` boolean field
      for (const cfg of result.value.configuration) {
        expect(cfg).toHaveProperty('file');
        expect(cfg).toHaveProperty('type');
        expect(cfg).toHaveProperty('exists');
        expect(cfg).toHaveProperty('path');
      }
    }
  });

  it('detects config files in known project directory', async () => {
    const bus = new EventBus();
    const scanner = new ProjectScanner(bus);
    const result = await scanner.scan('.');
    expect(result.ok).toBe(true);
  });

  it('only reports config files that exist', async () => {
    // Create a temp dir with only a package.json and tsconfig.json
    const tmpDir = join(tmpdir(), `viskod-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-proj' }));
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }));

    const bus = new EventBus();
    const scanner = new ProjectScanner(bus);
    const result = await scanner.scan(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const configFiles = result.value.configuration;
      // tsconfig.json should exist
      const tsConfig = configFiles.find((c) => c.file === 'tsconfig.json');
      expect(tsConfig).toBeDefined();
      expect(tsConfig?.exists).toBe(true);
      // next.config.js should NOT exist
      const nextConfig = configFiles.find((c) => c.file === 'next.config.js');
      expect(nextConfig).toBeDefined();
      expect(nextConfig?.exists).toBe(false);
      // tailwind.config.js should NOT exist
      const twConfig = configFiles.find((c) => c.file === 'tailwind.config.js');
      expect(twConfig).toBeDefined();
      expect(twConfig?.exists).toBe(false);
    }
  });

  it('detects workspace type from pnpm-workspace.yaml', async () => {
    const tmpDir = join(tmpdir(), `viskod-ws-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-ws' }));
    writeFileSync(join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');

    const bus = new EventBus();
    const scanner = new ProjectScanner(bus);
    const result = await scanner.scan(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata.workspaceType).toBe('pnpm-workspace');
    }
  });

  it('discovers Next App Router routes under src and strips route groups', async () => {
    const tmpDir = join(tmpdir(), `viskod-next-src-app-test-${Date.now()}`);
    mkdirSync(join(tmpDir, 'src', 'app', '(marketing)'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'next-src-app', dependencies: { next: '^15.0.0' } }),
    );
    writeFileSync(
      join(tmpDir, 'src', 'app', '(marketing)', 'page.tsx'),
      'export default function Page() {}',
    );
    writeFileSync(
      join(tmpDir, 'src', 'app', '(marketing)', 'layout.tsx'),
      'export default function Layout() {}',
    );

    const result = await new ProjectScanner(new EventBus()).scan(tmpDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.routes.routes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: '/',
            file: '/(marketing)/page.tsx',
            type: 'page',
          }),
          expect.objectContaining({
            path: '/',
            file: '/(marketing)/layout.tsx',
            type: 'layout',
          }),
        ]),
      );
    }
  });

  it('health returns before any scan', () => {
    const bus = new EventBus();
    const scanner = new ProjectScanner(bus);
    const health = scanner.health();
    expect(health.status).toBe('healthy');
    expect(health.lastScanTimestamp).toBeNull();
    expect(health.projectsScanned).toBe(0);
  });
});
