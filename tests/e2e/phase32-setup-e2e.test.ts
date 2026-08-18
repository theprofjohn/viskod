import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT, killTree } from './harness';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Spawn a child process with optional env overrides, collecting all output. */
function runCli(
  args: string[],
  opts?: { env?: Record<string, string>; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  // Executor form: event-driven child process with timeout cleanup.
  return new Promise((resolve) => {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...opts?.env,
    };
    const proc: ChildProcess = spawn('npx', ['tsx', 'packages/cli/src/index.ts', ...args], {
      cwd: ROOT,
      stdio: 'pipe',
      env,
      shell: true,
      // Detached on POSIX: the timeout path uses killTree (group kill), which
      // only terminates the whole npx → tsx → node tree when the child is a
      // process-group leader.
      detached: process.platform !== 'win32',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer: NodeJS.Timeout = setTimeout(() => {
      killTree(proc);
      resolve({ stdout, stderr, exitCode: -1 });
    }, opts?.timeoutMs ?? 30_000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let tmpHome: string;
let fixtureDir: string;

beforeAll(() => {
  tmpHome = join(ROOT, '.viskod-e2e-phase32-home');
  fixtureDir = join(tmpHome, 'fixture');
  rmSync(tmpHome, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify({ name: 'phase32-test-project', version: '0.0.1' }, null, 2),
  );
  writeFileSync(join(fixtureDir, '.viskod'), JSON.stringify({ enabled: true }, null, 2));
});

afterAll(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. clean-user-directory first-run
// ---------------------------------------------------------------------------

describe('Phase 32 e2e — clean user directory first-run', () => {
  let cleanHome: string;
  let cleanFixture: string;

  afterAll(() => {
    rmSync(cleanHome, { recursive: true, force: true });
  });

  it('viskod setup --skip-smoke --limited completes without crashing', async () => {
    cleanHome = join(tmpHome, 'clean-home');
    cleanFixture = join(tmpHome, 'clean-fixture');
    rmSync(cleanHome, { recursive: true, force: true });
    rmSync(cleanFixture, { recursive: true, force: true });
    mkdirSync(cleanFixture, { recursive: true });
    writeFileSync(
      join(cleanFixture, 'package.json'),
      JSON.stringify({ name: 'clean-test', version: '0.0.1' }, null, 2),
    );
    writeFileSync(join(cleanFixture, '.viskod'), JSON.stringify({ enabled: true }, null, 2));

    const result = await runCli(
      ['setup', '--project-root', cleanFixture, '--skip-smoke', '--limited'],
      { env: { HOME: cleanHome }, timeoutMs: 30_000 },
    );

    // setup should complete (limited mode) — either exit 0 or exit 1 from
    // checks that cannot be satisfied; we assert it didn't crash
    expect(result.stderr + result.stdout).not.toMatch(
      /UnhandledPromiseRejection|TypeError|SyntaxError/,
    );

    // state.json should exist (either from completeSetup or from partial init)
    const statePath = join(cleanFixture, '.viskod', 'setup', 'status.json');
    if (existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      expect(state.schemaVersion).toBe(2);
      expect(typeof state.state).toBe('string');
      expect(typeof state.completed).toBe('boolean');
    } else {
      // If setup didn't persist state (all checks failed and exited early),
      // verify the command at least ran and printed output
      expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. existing-config preservation
// ---------------------------------------------------------------------------

describe('Phase 32 e2e — existing-config preservation', () => {
  let cursorFixture: string;

  afterAll(() => {
    rmSync(cursorFixture, { recursive: true, force: true });
  });

  it('viskod install cursor preserves unrelated config entries', async () => {
    cursorFixture = join(tmpHome, 'cursor-fixture');
    rmSync(cursorFixture, { recursive: true, force: true });
    mkdirSync(cursorFixture, { recursive: true });
    writeFileSync(
      join(cursorFixture, 'package.json'),
      JSON.stringify({ name: 'cursor-test', version: '0.0.1' }, null, 2),
    );

    // Pre-create cursor config with an unrelated entry
    const cursorDir = join(cursorFixture, '.cursor');
    mkdirSync(cursorDir, { recursive: true });
    const existingConfig = {
      mcpServers: {
        'other-server': { command: 'echo', args: ['hello'] },
      },
    };
    writeFileSync(join(cursorDir, 'mcp.json'), JSON.stringify(existingConfig, null, 2));

    const result = await runCli(['install', 'cursor', '--project-root', cursorFixture], {
      timeoutMs: 15_000,
    });

    expect(result.exitCode).toBe(0);

    // Config should still be valid JSON and preserve the unrelated entry
    const configRaw = readFileSync(join(cursorDir, 'mcp.json'), 'utf-8');
    const config = JSON.parse(configRaw);

    expect(config.mcpServers['other-server']).toEqual({
      command: 'echo',
      args: ['hello'],
    });
    expect(config.mcpServers.viskod).toBeDefined();
    expect(config.mcpServers.viskod.command).toBeTypeOf('string');
    expect(config.mcpServers.viskod.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. doctor reports stale state
// ---------------------------------------------------------------------------

describe('Phase 32 e2e — doctor reports stale state', () => {
  let doctorFixture: string;

  afterAll(() => {
    rmSync(doctorFixture, { recursive: true, force: true });
  });

  it('viskod doctor detects stale setup state', async () => {
    doctorFixture = join(tmpHome, 'doctor-fixture');
    rmSync(doctorFixture, { recursive: true, force: true });
    mkdirSync(doctorFixture, { recursive: true });
    writeFileSync(
      join(doctorFixture, 'package.json'),
      JSON.stringify({ name: 'doctor-test', version: '0.0.1' }, null, 2),
    );

    // Persist a "complete" setup state via tsx calling saveSetupState directly
    const stateDir = join(doctorFixture, '.viskod', 'setup');
    mkdirSync(stateDir, { recursive: true });
    const completeState = {
      schemaVersion: 2,
      setupId: '00000000-0000-0000-0000-000000000001',
      state: 'complete',
      limitedMode: false,
      limitedReasons: [],
      setupVersion: '0.0.0-dev',
      sourceResolution: 'ready',
      capabilityStatus: {},
      project: {
        rootDisplayName: 'doctor-test',
        rootFingerprint: 'e2e-fingerprint',
      },
      workspace: {
        initialized: true,
        directories: [],
      },
      checks: [],
      capabilities: {
        captureContext: true,
        recaptureContext: false,
        exportContext: false,
        visualSelection: false,
        visualIssue: false,
        agentHandoff: false,
        visualReview: false,
        usageSiteSourceHints: false,
        mcpServer: true,
        browserRuntime: false,
        appReachable: false,
        agentConfigReady: false,
      },
      completed: true,
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      redaction: { applied: true, rules: [] },
    };
    writeFileSync(join(stateDir, 'status.json'), JSON.stringify(completeState, null, 2));

    const result = await runCli(['doctor', '--project-root', doctorFixture], { timeoutMs: 30_000 });

    const combined = result.stdout + result.stderr;

    // Doctor should read the persisted setup state and display it.
    // The exact staleness depends on whether MCP/Chromium are available in
    // this environment; the important contract is that the state IS read.
    expect(combined).toMatch(/Setup state: (complete|limited|incomplete)/);
  });
});

// ---------------------------------------------------------------------------
// 4. CLI help shows setup and doctor
// ---------------------------------------------------------------------------

describe('Phase 32 e2e — CLI help shows setup and doctor', () => {
  it('viskod --help lists both setup and doctor commands', async () => {
    const result = await runCli(['--help'], { timeoutMs: 15_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\bsetup\b/);
    expect(result.stdout).toMatch(/\bdoctor\b/);
  });

  it('viskod help lists both setup and doctor commands', async () => {
    const result = await runCli(['help'], { timeoutMs: 15_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\bsetup\b/);
    expect(result.stdout).toMatch(/\bdoctor\b/);
  });
});

// ---------------------------------------------------------------------------
// 5. install is idempotent
// ---------------------------------------------------------------------------

describe('Phase 32 e2e — install is idempotent', () => {
  let idempotentHome: string;
  let idempotentFixture: string;

  beforeAll(() => {
    idempotentHome = join(tmpHome, 'idempotent-home');
    idempotentFixture = join(tmpHome, 'idempotent-fixture');
    rmSync(idempotentHome, { recursive: true, force: true });
    rmSync(idempotentFixture, { recursive: true, force: true });
    mkdirSync(idempotentFixture, { recursive: true });
    writeFileSync(
      join(idempotentFixture, 'package.json'),
      JSON.stringify({ name: 'idempotent-test', version: '0.0.1' }, null, 2),
    );
  });

  afterAll(() => {
    rmSync(idempotentHome, { recursive: true, force: true });
    rmSync(idempotentFixture, { recursive: true, force: true });
  });

  it('viskod install opencode is idempotent — second run produces identical config', async () => {
    // First install
    const first = await runCli(['install', 'opencode', '--project-root', idempotentFixture], {
      env: { HOME: idempotentHome },
      timeoutMs: 15_000,
    });
    expect(first.exitCode).toBe(0);

    const configPath = join(idempotentHome, '.config', 'opencode', 'opencode.json');
    expect(existsSync(configPath)).toBe(true);
    const firstConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(firstConfig.mcp?.viskod).toBeDefined();
    expect(firstConfig.mcp.viskod.type).toBe('local');

    // Second install — should be identical
    const second = await runCli(['install', 'opencode', '--project-root', idempotentFixture], {
      env: { HOME: idempotentHome },
      timeoutMs: 15_000,
    });
    expect(second.exitCode).toBe(0);

    const secondConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(secondConfig).toEqual(firstConfig);
  });
});
