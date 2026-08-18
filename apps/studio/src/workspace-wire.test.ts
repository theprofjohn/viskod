import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { ProjectScanner } from '@viskod/project-scanner';
import { describe, expect, it } from 'vitest';

describe('Studio workspace wiring', () => {
  it('establishProjectContext threads workspace', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-studio-test-'));
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    fs.mkdirSync(path.join(tmpDir, 'packages/web'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'packages/web/package.json'),
      JSON.stringify({ name: '@acme/web', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' }),
    );

    const scanner = new ProjectScanner(new EventBus({ enableHistory: false }));
    const workspaceResult = await scanner.discoverWorkspace(tmpDir);
    expect(workspaceResult.ok).toBe(true);
    if (workspaceResult.ok) {
      expect(workspaceResult.value.isWorkspace).toBe(true);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
