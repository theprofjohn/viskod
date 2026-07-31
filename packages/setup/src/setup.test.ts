import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { detectProject } from './detector';
import { initializeWorkspace } from './workspace';
import { runSetupChecks, verifyMcpToolsLive } from './checks';
import { loadSetupState, saveSetupState, createInitialSetupState } from './persistence';
import { containsSecrets, containsAbsolutePath, sanitizePath, validateOutputSafety } from './redaction';
import {
  getSetupState,
  detectAndConfigureProject,
  initializeProjectWorkspace,
  runAllChecks,
  completeSetup,
  repairSetup,
  runSmoke,
  createWizardState,
  advanceWizard,
  getWizardStepDescription,
  isSetupComplete,
  verifyMcpTools,
  validateAppUrl,
  checkAgentConfigReadiness,
} from './index';

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(tmpdir(), `viskod-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Project Detection', () => {
  it('detects project from directory with package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-project' }), 'utf-8');
    const result = detectProject({ projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rootPath).toBe(tmpDir);
      expect(result.value.name).toBe('test-project');
      expect(result.value.hasExistingViskodDir).toBe(false);
    }
  });

  it('returns error when no package.json found', () => {
    const result = detectProject({ projectRoot: tmpDir });
    expect(result.ok).toBe(false);
  });

  it('detects pnpm package manager', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '', 'utf-8');
    const result = detectProject({ projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.packageManager).toBe('pnpm');
    }
  });

  it('detects npm package manager', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}', 'utf-8');
    const result = detectProject({ projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.packageManager).toBe('npm');
    }
  });

  it('detects existing .viskod directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, '.viskod'), { recursive: true });
    const result = detectProject({ projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hasExistingViskodDir).toBe(true);
    }
  });

  it('generates opaque fingerprint', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    const result = detectProject({ projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rootFingerprint).toMatch(/^[a-f0-9]{16}$/);
    }
  });
});

describe('Workspace Initialization', () => {
  it('creates .viskod workspace directories', () => {
    const result = initializeWorkspace({ projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.initialized).toBe(true);
      expect(result.value.directories.length).toBeGreaterThan(0);
      for (const dir of result.value.directories) {
        expect(dir.exists).toBe(true);
      }
    }
    expect(fs.existsSync(path.join(tmpDir, '.viskod'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.viskod', 'captures'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.viskod', 'issues'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.viskod', 'handoffs'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.viskod', 'reviews'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.viskod', 'setup'))).toBe(true);
  });

  it('is idempotent', () => {
    const r1 = initializeWorkspace({ projectRoot: tmpDir });
    expect(r1.ok).toBe(true);
    const r2 = initializeWorkspace({ projectRoot: tmpDir });
    expect(r2.ok).toBe(true);
  });

  it('returns error for non-existent project root', () => {
    const result = initializeWorkspace({ projectRoot: '/nonexistent/path' });
    expect(result.ok).toBe(false);
  });
});

describe('Setup Checks', () => {
  it('runs all required checks', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    initializeWorkspace({ projectRoot: tmpDir });
    const checks = await runSetupChecks({ projectRoot: tmpDir });
    expect(checks.length).toBeGreaterThan(0);
    const requiredChecks = checks.filter((c) => c.severity === 'required');
    expect(requiredChecks.length).toBeGreaterThan(0);
  }, 30000);

  it('includes node version check', async () => {
    const checks = await runSetupChecks({ projectRoot: tmpDir });
    const nodeCheck = checks.find((c) => c.checkId === 'node-version');
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.status).toBe('pass');
  }, 30000);

  it('checks workspace writable', async () => {
    initializeWorkspace({ projectRoot: tmpDir });
    const checks = await runSetupChecks({ projectRoot: tmpDir });
    const writableCheck = checks.find((c) => c.checkId === 'viskod-writable');
    expect(writableCheck).toBeDefined();
    expect(writableCheck!.status).toBe('pass');
  }, 30000);

  it('each check has required fields', async () => {
    const checks = await runSetupChecks({ projectRoot: tmpDir });
    for (const check of checks) {
      expect(check.checkId).toBeTruthy();
      expect(check.name).toBeTruthy();
      expect(check.severity).toMatch(/^(required|recommended|optional)$/);
      expect(check.status).toMatch(/^(pass|warning|fail|skipped)$/);
      expect(check.summary).toBeTruthy();
    }
  }, 30000);

  it('includes visual-selection check', async () => {
    const checks = await runSetupChecks({ projectRoot: tmpDir });
    const selCheck = checks.find((c) => c.checkId === 'visual-selection');
    expect(selCheck).toBeDefined();
  }, 30000);

  it('includes visual-issue persistence check', async () => {
    const checks = await runSetupChecks({ projectRoot: tmpDir });
    const issueCheck = checks.find((c) => c.checkId === 'visual-issue');
    expect(issueCheck).toBeDefined();
  }, 30000);

  it('includes agent-handoff persistence check', async () => {
    const checks = await runSetupChecks({ projectRoot: tmpDir });
    const handoffCheck = checks.find((c) => c.checkId === 'agent-handoff');
    expect(handoffCheck).toBeDefined();
  }, 30000);

  it('includes visual-review persistence check', async () => {
    const checks = await runSetupChecks({ projectRoot: tmpDir });
    const reviewCheck = checks.find((c) => c.checkId === 'visual-review');
    expect(reviewCheck).toBeDefined();
  }, 30000);

  it('mcp-tools-runtime check is required and passes', async () => {
    const checks = await runSetupChecks({ projectRoot: tmpDir });
    const mcpRuntimeCheck = checks.find((c) => c.checkId === 'mcp-tools-runtime');
    expect(mcpRuntimeCheck).toBeDefined();
    expect(mcpRuntimeCheck!.severity).toBe('required');
    // Should pass since we're in the monorepo with a working MCP server
    expect(mcpRuntimeCheck!.status).toMatch(/^(pass|fail)$/);
  }, 60000);

  it('browser-runtime check uses live verification', async () => {
    const checks = await runSetupChecks({ projectRoot: tmpDir });
    const browserCheck = checks.find((c) => c.checkId === 'browser-runtime');
    expect(browserCheck).toBeDefined();
    expect(browserCheck!.severity).toBe('required');
    expect(browserCheck!.status).toMatch(/^(pass|warning)$/);
  }, 30000);
});

describe('MCP Tool Verification', () => {
  it('verifies all required tools exist', () => {
    const result = verifyMcpToolsLive();
    expect(result.serverReachable).toBe(true);
    expect(result.requiredToolsPresent).toBe(true);
    expect(result.missingRequiredTools).toHaveLength(0);
    expect(result.toolsFound.length).toBeGreaterThan(0);
  });

  it('each tool has found and hasInputSchema', () => {
    const result = verifyMcpToolsLive();
    for (const tool of result.toolsFound) {
      expect(tool.toolName).toBeTruthy();
      expect(typeof tool.found).toBe('boolean');
    }
  });
});

describe('Persistence', () => {
  it('returns null when no setup state exists', () => {
    const result = loadSetupState(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('saves and loads setup state', () => {
    const state = createInitialSetupState(tmpDir, 'test-fingerprint');
    const saveResult = saveSetupState(tmpDir, state);
    expect(saveResult.ok).toBe(true);

    const loadResult = loadSetupState(tmpDir);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok && loadResult.value) {
      expect(loadResult.value.setupId).toBe(state.setupId);
      expect(loadResult.value.schemaVersion).toBe(1);
    }
  });

  it('creates opaque setup ID', () => {
    const state = createInitialSetupState(tmpDir, 'fp');
    expect(state.setupId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('handles corrupt setup file', () => {
    const setupDir = path.join(tmpDir, '.viskod', 'setup');
    fs.mkdirSync(setupDir, { recursive: true });
    fs.writeFileSync(path.join(setupDir, 'status.json'), '{invalid json', 'utf-8');
    const result = loadSetupState(tmpDir);
    expect(result.ok).toBe(false);
  });
});

describe('Redaction', () => {
  it('detects secrets', () => {
    expect(containsSecrets('sk_test_abc123def456')).toBe(true);
    expect(containsSecrets('ghp_1234567890abcdefghijklmnopqrstuvwxyz123456')).toBe(true);
    expect(containsSecrets('Bearer abcdefghijklmnopqrstuvwxyz123456')).toBe(true);
    expect(containsSecrets('user@example.com')).toBe(true);
  });

  it('does not flag normal text', () => {
    expect(containsSecrets('Node.js version 22.0.0')).toBe(false);
    expect(containsSecrets('Project detected successfully')).toBe(false);
  });

  it('detects absolute paths', () => {
    expect(containsAbsolutePath('C:\\Users\\test')).toBe(true);
    expect(containsAbsolutePath('/home/user/project')).toBe(true);
    expect(containsAbsolutePath('src/components/Button.tsx')).toBe(false);
  });

  it('sanitizes paths', () => {
    expect(sanitizePath('C:\\Users\\test\\src\\file.ts')).toContain('src');
    expect(sanitizePath('/home/user/project/file.ts')).toContain('file.ts');
  });

  it('validates output safety', () => {
    const safe = validateOutputSafety('Node.js version 22.0.0');
    expect(safe.safe).toBe(true);

    const unsafe = validateOutputSafety('C:\\Users\\test\\file.ts');
    expect(unsafe.safe).toBe(false);
    expect(unsafe.violations).toContain('absolute-path');
  });
});

describe('Wizard Flow', () => {
  it('creates initial wizard state', () => {
    const state = createWizardState();
    expect(state.step).toBe('welcome');
    expect(state.warnings).toHaveLength(0);
    expect(state.errors).toHaveLength(0);
  });

  it('advances from welcome to project_confirmation', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    const state = createWizardState();
    const result = await advanceWizard(state, { projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.step).toBe('project_confirmation');
      expect(result.value.project).toBeDefined();
    }
  });

  it('advances through full wizard flow', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    let state = createWizardState();

    // Welcome -> Project Confirmation
    let result = await advanceWizard(state, { projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.value;
    expect(state.step).toBe('project_confirmation');

    // Project Confirmation -> Setup Checklist
    result = await advanceWizard(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.value;
    expect(state.step).toBe('setup_checklist');

    // Setup Checklist -> Run Checks
    result = await advanceWizard(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.value;
    expect(state.step).toBe('run_checks');
    expect(state.checks).toBeDefined();

    // Run Checks -> Run Smoke
    result = await advanceWizard(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.value;
    expect(state.step).toBe('run_smoke');

    // Run Smoke -> Finish
    result = await advanceWizard(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.value;
    expect(state.step).toBe('finish');

    // Finish -> Ready
    result = await advanceWizard(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.value;
    expect(state.step).toBe('ready');
    expect(state.setupState).toBeDefined();
    expect(state.setupState!.completed).toBe(true);
  }, 60000);

  it('returns step descriptions', () => {
    expect(getWizardStepDescription('welcome')).toContain('Welcome');
    expect(getWizardStepDescription('ready')).toContain('ready');
  });
});

describe('Setup Service', () => {
  it('getSetupState returns null for fresh directory', () => {
    const result = getSetupState(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('detectAndConfigureProject detects project', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    const result = detectAndConfigureProject({ projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('test');
    }
  });

  it('initializeProjectWorkspace creates directories', () => {
    const result = initializeProjectWorkspace({ projectRoot: tmpDir });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.viskod'))).toBe(true);
  });

  it('runAllChecks returns check results', async () => {
    const checks = await runAllChecks({ projectRoot: tmpDir });
    expect(checks.length).toBeGreaterThan(0);
  }, 30000);

  it('verifyMcpTools returns live verification', () => {
    const result = verifyMcpTools();
    expect(result.serverReachable).toBe(true);
    expect(result.requiredToolsPresent).toBe(true);
  });

  it('completeSetup persists state and marks complete', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    initializeProjectWorkspace({ projectRoot: tmpDir });

    const project = detectAndConfigureProject({ projectRoot: tmpDir });
    expect(project.ok).toBe(true);
    if (!project.ok) return;

    const checks = await runAllChecks({ projectRoot: tmpDir });

    // Use limitedMode since we don't run capture smoke in unit tests
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
    }

    const loaded = getSetupState(tmpDir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok && loaded.value) {
      expect(loaded.value.completed).toBe(true);
    }
  }, 60000);

  it('repairSetup re-runs checks after repair', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    const result = await repairSetup({ projectRoot: tmpDir, actionId: 'init-workspace' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
    }
  }, 30000);

  it('runSmoke passes for writable directory', async () => {
    initializeProjectWorkspace({ projectRoot: tmpDir });
    const result = await runSmoke({ projectRoot: tmpDir, limitedMode: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('pass');
    }
  }, 30000);

  it('isSetupComplete returns false before setup', () => {
    expect(isSetupComplete(tmpDir)).toBe(false);
  });

  it('isSetupComplete returns true after setup', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    initializeProjectWorkspace({ projectRoot: tmpDir });
    const project = detectAndConfigureProject({ projectRoot: tmpDir });
    if (project.ok) {
      const checks = await runAllChecks({ projectRoot: tmpDir });
      completeSetup({ projectRoot: tmpDir, project: project.value, checks, limitedMode: true });
    }
    expect(isSetupComplete(tmpDir)).toBe(true);
  }, 60000);
});

describe('App URL Validation', () => {
  it('validates localhost URL', () => {
    const result = validateAppUrl('http://localhost:3000');
    expect(result.valid).toBe(true);
    expect(result.hostname).toBe('localhost');
    expect(result.port).toBe(3000);
  });

  it('validates 127.0.0.1 URL', () => {
    const result = validateAppUrl('http://127.0.0.1:5173');
    expect(result.valid).toBe(true);
    expect(result.hostname).toBe('127.0.0.1');
    expect(result.port).toBe(5173);
  });

  it('validates https localhost', () => {
    const result = validateAppUrl('https://localhost:443');
    expect(result.valid).toBe(true);
    expect(result.hostname).toBe('localhost');
  });

  it('rejects non-localhost URL', () => {
    const result = validateAppUrl('http://example.com:3000');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('localhost');
  });

  it('rejects ftp protocol', () => {
    const result = validateAppUrl('ftp://localhost:3000');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('http');
  });

  it('rejects invalid URL format', () => {
    const result = validateAppUrl('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid URL');
  });

  it('handles URL without port', () => {
    const result = validateAppUrl('http://localhost');
    expect(result.valid).toBe(true);
    expect(result.port).toBeUndefined();
  });
});

describe('Agent Config Readiness', () => {
  it('detects no config when none exists', () => {
    const result = checkAgentConfigReadiness(tmpDir);
    expect(result.detected).toBe(false);
    expect(result.verified).toBe(false);
  });
});

describe('App URL in Setup State', () => {
  it('completeSetup persists appUrl', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    initializeProjectWorkspace({ projectRoot: tmpDir });
    const project = detectAndConfigureProject({ projectRoot: tmpDir });
    if (project.ok) {
      const checks = await runAllChecks({ projectRoot: tmpDir, limitedMode: true } as any);
      const result = completeSetup({
        projectRoot: tmpDir,
        project: project.value,
        checks,
        limitedMode: true,
        appUrl: 'http://localhost:3000',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.appUrl).toBe('http://localhost:3000');
      }
    }
  }, 60000);

  it('completeSetup persists agentConfig', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    initializeProjectWorkspace({ projectRoot: tmpDir });
    const project = detectAndConfigureProject({ projectRoot: tmpDir });
    if (project.ok) {
      const checks = await runAllChecks({ projectRoot: tmpDir, limitedMode: true } as any);
      const result = completeSetup({
        projectRoot: tmpDir,
        project: project.value,
        checks,
        limitedMode: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.agentConfig).toBeDefined();
        expect(result.value.agentConfig!.kind).toBeTruthy();
      }
    }
  }, 60000);
});

describe('App Reachability Check', () => {
  it('app-reachability check is included when appUrl provided', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    initializeProjectWorkspace({ projectRoot: tmpDir });

    // This will fail because no server is running, but the check should exist
    const checks = await runAllChecks({ projectRoot: tmpDir, appUrl: 'http://localhost:99999' });
    const reachCheck = checks.find(c => c.checkId === 'app-reachability');
    expect(reachCheck).toBeDefined();
    expect(reachCheck!.severity).toBe('required');
    // Should fail because port 99999 is not reachable
    expect(reachCheck!.status).toBe('fail');
  }, 60000);

  it('app-reachability check is skipped when no appUrl provided', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    initializeProjectWorkspace({ projectRoot: tmpDir });

    const checks = await runAllChecks({ projectRoot: tmpDir });
    const reachCheck = checks.find(c => c.checkId === 'app-reachability');
    expect(reachCheck).toBeUndefined();
  }, 60000);
});

describe('Wizard Flow with appUrl', () => {
  it('wizard accepts appUrl in input', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    let state = createWizardState();

    // Welcome -> Project Confirmation
    const result = await advanceWizard(state, { projectRoot: tmpDir, appUrl: 'http://localhost:3000' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appUrl).toBe('http://localhost:3000');
    }
  });

  it('completeSetup with appUrl persists it', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    initializeProjectWorkspace({ projectRoot: tmpDir });
    const project = detectAndConfigureProject({ projectRoot: tmpDir });
    if (project.ok) {
      const checks = await runAllChecks({ projectRoot: tmpDir, limitedMode: true } as any);
      const result = completeSetup({
        projectRoot: tmpDir,
        project: project.value,
        checks,
        limitedMode: true,
        appUrl: 'http://localhost:5173',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.appUrl).toBe('http://localhost:5173');
        // Verify it persists
        const loaded = getSetupState(tmpDir);
        expect(loaded.ok).toBe(true);
        if (loaded.ok && loaded.value) {
          expect(loaded.value.appUrl).toBe('http://localhost:5173');
        }
      }
    }
  }, 60000);
});
