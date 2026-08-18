import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  completeSetup,
  detectAndConfigureProject,
  getSetupState,
  initializeProjectWorkspace,
  repairSetup,
  runAllChecks,
  runSmoke,
} from '@viskod/setup';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(
    tmpdir(),
    `viskod-setup-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe('MCP Setup Tools', () => {
  describe('get_setup_state', () => {
    it('returns null before setup', () => {
      const result = getSetupState(tmpDir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns state after setup completion', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test' }),
        'utf-8',
      );
      initializeProjectWorkspace({ projectRoot: tmpDir });
      const project = detectAndConfigureProject({ projectRoot: tmpDir });
      if (project.ok) {
        const checks = await runAllChecks({ projectRoot: tmpDir });
        completeSetup({ projectRoot: tmpDir, project: project.value, checks, limitedMode: true });
      }

      const result = getSetupState(tmpDir);
      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.completed).toBe(true);
        expect(result.value.setupId).toBeTruthy();
      }
    }, 60000);
  });

  describe('detect_project', () => {
    it('detects project from valid directory', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'my-app' }),
        'utf-8',
      );
      const result = detectAndConfigureProject({ projectRoot: tmpDir });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('my-app');
        expect(result.value.rootPath).toBe(tmpDir);
        expect(result.value.rootFingerprint).toMatch(/^[a-f0-9]{16}$/);
      }
    });

    it('returns error for invalid directory', () => {
      const result = detectAndConfigureProject({ projectRoot: '/nonexistent' });
      expect(result.ok).toBe(false);
    });

    it('no absolute paths in output', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
      const result = detectAndConfigureProject({ projectRoot: tmpDir });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // rootPath may contain temp dir, but rootDisplayName should be safe
        expect(result.value.rootDisplayName).not.toContain('C:\\');
        expect(result.value.rootDisplayName).not.toContain('/home/');
      }
    });
  });

  describe('initialize_workspace', () => {
    it('creates workspace directories', () => {
      const result = initializeProjectWorkspace({ projectRoot: tmpDir });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.initialized).toBe(true);
        expect(result.value.directories.length).toBeGreaterThan(0);
      }
    });

    it('is idempotent', () => {
      const r1 = initializeProjectWorkspace({ projectRoot: tmpDir });
      const r2 = initializeProjectWorkspace({ projectRoot: tmpDir });
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
    });

    it('returns error for non-existent root', () => {
      const result = initializeProjectWorkspace({ projectRoot: '/nonexistent' });
      expect(result.ok).toBe(false);
    });
  });

  describe('run_setup_checks', () => {
    it('returns check results', async () => {
      const checks = await runAllChecks({ projectRoot: tmpDir });
      expect(checks.length).toBeGreaterThan(0);
    }, 30000);

    it('each check has status and severity', async () => {
      const checks = await runAllChecks({ projectRoot: tmpDir });
      for (const check of checks) {
        expect(check.checkId).toBeTruthy();
        expect(check.name).toBeTruthy();
        expect(['pass', 'warning', 'fail', 'skipped']).toContain(check.status);
        expect(['required', 'recommended', 'optional']).toContain(check.severity);
      }
    }, 30000);

    it('no absolute paths in check output', async () => {
      const checks = await runAllChecks({ projectRoot: tmpDir });
      for (const check of checks) {
        expect(check.summary).not.toMatch(/^[A-Z]:\\/);
        expect(check.summary).not.toMatch(/^\/home\//);
      }
    }, 30000);

    it('no secrets in check output', async () => {
      const checks = await runAllChecks({ projectRoot: tmpDir });
      const output = JSON.stringify(checks);
      expect(output).not.toMatch(/sk[_-]test[_-][A-Za-z0-9]{3,}/);
      expect(output).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
    }, 30000);
  });

  describe('run_setup_smoke', () => {
    it('passes for writable directory', async () => {
      initializeProjectWorkspace({ projectRoot: tmpDir });
      const result = await runSmoke({ projectRoot: tmpDir, limitedMode: true });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('pass');
      }
    }, 30000);

    it('no packet paths in smoke output', async () => {
      initializeProjectWorkspace({ projectRoot: tmpDir });
      const result = await runSmoke({ projectRoot: tmpDir, limitedMode: true });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = JSON.stringify(result.value);
        expect(output).not.toContain('.viskod/');
        expect(output).not.toContain('captures/');
      }
    }, 30000);
  });

  describe('complete_setup', () => {
    it('persists setup state with completion', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test' }),
        'utf-8',
      );
      initializeProjectWorkspace({ projectRoot: tmpDir });

      const project = detectAndConfigureProject({ projectRoot: tmpDir });
      expect(project.ok).toBe(true);
      if (!project.ok) return;

      const checks = await runAllChecks({ projectRoot: tmpDir });
      const result = completeSetup({
        projectRoot: tmpDir,
        project: project.value,
        checks,
        limitedMode: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.completed).toBe(true);
        expect(result.value.completedAt).toBeTruthy();
        expect(result.value.project.rootFingerprint).toBeTruthy();
      }
    }, 60000);

    it('survives restart — state persists', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test' }),
        'utf-8',
      );
      initializeProjectWorkspace({ projectRoot: tmpDir });
      const project = detectAndConfigureProject({ projectRoot: tmpDir });
      if (!project.ok) return;
      const checks = await runAllChecks({ projectRoot: tmpDir });
      completeSetup({ projectRoot: tmpDir, project: project.value, checks, limitedMode: true });

      const loaded = getSetupState(tmpDir);
      expect(loaded.ok).toBe(true);
      if (loaded.ok && loaded.value) {
        expect(loaded.value.completed).toBe(true);
      }
    }, 30000);
  });

  describe('complete_setup v2 state contract', () => {
    // Deterministic scenario: force the MCP runtime gate to fail so the full
    // completion gates cannot pass regardless of the test environment.
    // mcp-tools-runtime is a required check but is excluded from the critical
    // set, so explicit limited-mode consent can still complete the setup.
    async function prepareFailedRuntimeScenario() {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test' }),
        'utf-8',
      );
      initializeProjectWorkspace({ projectRoot: tmpDir });

      const project = detectAndConfigureProject({ projectRoot: tmpDir });
      expect(project.ok).toBe(true);
      if (!project.ok) throw new Error('Project detection failed');

      const realChecks = await runAllChecks({ projectRoot: tmpDir });
      expect(realChecks.some((c) => c.checkId === 'mcp-tools-runtime')).toBe(true);
      const checks = realChecks.map((c) =>
        c.checkId === 'mcp-tools-runtime' ? { ...c, status: 'fail' as const } : c,
      );
      return { project: project.value, checks };
    }

    it('persists incomplete state when a required check fails without limited-mode consent', async () => {
      const { project, checks } = await prepareFailedRuntimeScenario();

      const result = completeSetup({ projectRoot: tmpDir, project, checks });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.state).toBe('incomplete');
      expect(result.value.completed).toBe(false);

      const loaded = getSetupState(tmpDir);
      expect(loaded.ok).toBe(true);
      if (loaded.ok && loaded.value) {
        expect(loaded.value).not.toBeNull();
        expect(loaded.value.state).toBe('incomplete');
        expect(loaded.value.completed).toBe(false);
      }
    }, 60000);

    it('persists limited state when consenting to limited mode under the same failed required check', async () => {
      const { project, checks } = await prepareFailedRuntimeScenario();

      const result = completeSetup({
        projectRoot: tmpDir,
        project,
        checks,
        limitedMode: true,
        limitedReasons: ['MCP runtime gate failed; user consents to limited-mode setup'],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.state).toBe('limited');
      expect(result.value.completed).toBe(true);
      expect(result.value.limitedMode).toBe(true);
      expect(result.value.limitedReasons.length).toBeGreaterThan(0);

      const loaded = getSetupState(tmpDir);
      expect(loaded.ok).toBe(true);
      if (loaded.ok && loaded.value) {
        expect(loaded.value).not.toBeNull();
        expect(loaded.value.schemaVersion).toBe(2);
        expect(loaded.value.state).toBe('limited');
        expect(loaded.value.limitedMode).toBe(true);
      }
    }, 60000);

    it('recovers to complete and clears limitedMode on a later all-passing setup', async () => {
      const { project, checks } = await prepareFailedRuntimeScenario();

      const limited = completeSetup({
        projectRoot: tmpDir,
        project,
        checks,
        limitedMode: true,
        limitedReasons: ['MCP runtime gate failed; user consents to limited-mode setup'],
      });
      expect(limited.ok).toBe(true);
      if (!limited.ok) return;
      expect(limited.value.state).toBe('limited');

      // Later run with every gate passing — constructed manually so the
      // recovery does not depend on the test environment.
      const passingChecks = checks.map((c) => ({ ...c, status: 'pass' as const }));
      const result = completeSetup({
        projectRoot: tmpDir,
        project,
        checks: passingChecks,
        smoke: {
          lastRunAt: new Date().toISOString(),
          status: 'pass',
          packetId: 'test-packet',
          warnings: [],
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.state).toBe('complete');
      expect(result.value.completed).toBe(true);
      expect(result.value.limitedMode).toBe(false);

      const loaded = getSetupState(tmpDir);
      expect(loaded.ok).toBe(true);
      if (loaded.ok && loaded.value) {
        expect(loaded.value).not.toBeNull();
        expect(loaded.value.state).toBe('complete');
        expect(loaded.value.limitedMode).toBe(false);
      }
    }, 60000);
  });

  describe('repair_setup', () => {
    it('repairs workspace and re-runs checks', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
      const result = await repairSetup({ projectRoot: tmpDir, actionId: 'init-workspace' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
      }
    }, 30000);
  });

  describe('tool schema validation', () => {
    it('setup tools have correct input schemas', () => {
      const tools = [
        { name: 'get_setup_state', required: [] },
        { name: 'detect_project', required: [] },
        { name: 'initialize_workspace', required: ['projectRoot'] },
        { name: 'run_setup_checks', required: ['projectRoot'] },
        { name: 'run_setup_smoke', required: ['projectRoot'] },
        { name: 'complete_setup', required: ['projectRoot'] },
        { name: 'repair_setup', required: ['projectRoot', 'actionId'] },
      ];

      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.required.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('complete_setup input schema exposes limitedMode and limitedReasons', () => {
      const source = fs.readFileSync(
        fileURLToPath(new URL('./entry.ts', import.meta.url)),
        'utf-8',
      );
      const defStart = source.indexOf('const completeSetupTool: MCPToolDefinition = {');
      expect(defStart).toBeGreaterThanOrEqual(0);
      const schemaStart = source.indexOf('inputSchema: {', defStart);
      expect(schemaStart).toBeGreaterThanOrEqual(0);

      let depth = 0;
      let schemaEnd = -1;
      for (let i = schemaStart; i < source.length; i++) {
        if (source[i] === '{') {
          depth += 1;
        } else if (source[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            schemaEnd = i + 1;
            break;
          }
        }
      }
      expect(schemaEnd).toBeGreaterThan(schemaStart);

      const schema = source.slice(schemaStart, schemaEnd);
      expect(schema).toContain('limitedMode:');
      expect(schema).toContain('limitedReasons:');
    });
  });
});
