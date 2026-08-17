import { describe, it, expect } from 'vitest';
import { ProjectScanner } from '@viskod/project-scanner';
import { EventBus } from '@viskod/event-bus';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('CLI workspace wiring', () => {
  it('discoverWorkspace returns workspace metadata for monorepo', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-cli-test-'));
    // Create a minimal pnpm workspace
    fs.writeFileSync(
      path.join(tmpDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\n',
    );
    fs.mkdirSync(path.join(tmpDir, 'packages/ui'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'packages/ui/package.json'),
      JSON.stringify({ name: '@acme/ui', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' }),
    );

    const scanner = new ProjectScanner(new EventBus({ enableHistory: false }));
    const result = await scanner.discoverWorkspace(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isWorkspace).toBe(true);
      expect(result.value.packages).toHaveLength(1);
      expect(result.value.packages[0].name).toBe('@acme/ui');
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discoverWorkspace returns isWorkspace false for single package', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-cli-single-'));
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'single-pkg', version: '1.0.0' }),
    );

    const scanner = new ProjectScanner(new EventBus({ enableHistory: false }));
    const result = await scanner.discoverWorkspace(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isWorkspace).toBe(false);
      expect(result.value.packages).toHaveLength(0);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
