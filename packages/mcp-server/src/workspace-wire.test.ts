import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { ProjectScanner } from '@viskod/project-scanner';
import { describe, expect, it } from 'vitest';

describe('MCP workspace wiring', () => {
  it('ensureProjectScan threads workspace to setProjectContext', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-mcp-test-'));
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    fs.mkdirSync(path.join(tmpDir, 'packages/api'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'packages/api/package.json'),
      JSON.stringify({ name: '@acme/api', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' }),
    );

    const scanner = new ProjectScanner(new EventBus({ enableHistory: false }));
    const workspaceResult = await scanner.discoverWorkspace(tmpDir);
    expect(workspaceResult.ok).toBe(true);
    if (workspaceResult.ok) {
      expect(workspaceResult.value.packages[0]?.name).toBe('@acme/api');
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
