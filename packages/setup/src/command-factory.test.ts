import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectRuntimeMode, getMcpServeCommand } from './command-factory';

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(
    os.tmpdir(),
    `viskod-command-factory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe('detectRuntimeMode', () => {
  it('returns "dev" when a viskod checkout is findable from cwd', () => {
    // Create a fake viskod checkout root: package.json with name "viskod"
    // and packages/cli/src/index.ts
    const checkoutRoot = path.join(tmpDir, 'fake-checkout');
    const cliDir = path.join(checkoutRoot, 'packages', 'cli', 'src');
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(checkoutRoot, 'package.json'), JSON.stringify({ name: 'viskod' }));
    fs.writeFileSync(path.join(cliDir, 'index.ts'), '');

    const mode = detectRuntimeMode({ cwd: checkoutRoot });
    expect(mode).toBe('dev');
  });

  it('detectRuntimeMode returns a valid RuntimeMode string', () => {
    // When running inside the real checkout, detectRuntimeMode always returns 'dev'.
    // The "installed" case is only reachable outside a checkout (tested indirectly
    // via getMcpServeCommand with explicit mode: 'installed').
    const mode = detectRuntimeMode();
    expect(mode === 'dev' || mode === 'installed').toBe(true);
  });
});

describe('getMcpServeCommand', () => {
  describe('dev mode', () => {
    it('returns npx as command with source entry in args', () => {
      // Set up a fake checkout so dev mode can find it
      const checkoutRoot = path.join(tmpDir, 'fake-checkout');
      const cliDir = path.join(checkoutRoot, 'packages', 'cli', 'src');
      fs.mkdirSync(cliDir, { recursive: true });
      fs.writeFileSync(path.join(checkoutRoot, 'package.json'), JSON.stringify({ name: 'viskod' }));
      fs.writeFileSync(path.join(cliDir, 'index.ts'), '');

      const cmd = getMcpServeCommand({ mode: 'dev', cwd: checkoutRoot });
      expect(cmd.mode).toBe('dev');
      expect(cmd.command).toBe('npx');
      expect(cmd.args[0]).toBe('tsx');
      expect(cmd.args).toContain('serve');
      // The entry path is the second arg (index 1)
      const entryPath = cmd.args[1];
      expect(entryPath).toContain('packages');
      expect(entryPath).toContain('cli');
      expect(entryPath).toContain('index.ts');
      expect(cmd.source).toBe('source-checkout');
    });

    it('includes --url when provided', () => {
      const checkoutRoot = path.join(tmpDir, 'fake-checkout');
      const cliDir = path.join(checkoutRoot, 'packages', 'cli', 'src');
      fs.mkdirSync(cliDir, { recursive: true });
      fs.writeFileSync(path.join(checkoutRoot, 'package.json'), JSON.stringify({ name: 'viskod' }));
      fs.writeFileSync(path.join(cliDir, 'index.ts'), '');

      const cmd = getMcpServeCommand({
        mode: 'dev',
        cwd: checkoutRoot,
        url: 'http://localhost:3000',
      });
      expect(cmd.args).toContain('--url');
      expect(cmd.args).toContain('http://localhost:3000');
    });

    it('includes --project-root when provided', () => {
      const checkoutRoot = path.join(tmpDir, 'fake-checkout');
      const cliDir = path.join(checkoutRoot, 'packages', 'cli', 'src');
      fs.mkdirSync(cliDir, { recursive: true });
      fs.writeFileSync(path.join(checkoutRoot, 'package.json'), JSON.stringify({ name: 'viskod' }));
      fs.writeFileSync(path.join(cliDir, 'index.ts'), '');

      const cmd = getMcpServeCommand({
        mode: 'dev',
        cwd: checkoutRoot,
        projectRoot: '/some/path',
      });
      expect(cmd.args).toContain('--project-root');
      expect(cmd.args).toContain('/some/path');
    });
  });

  describe('installed mode', () => {
    it('returns process.execPath as command', () => {
      const cmd = getMcpServeCommand({ mode: 'installed', cwd: tmpDir });
      expect(cmd.mode).toBe('installed');
      expect(cmd.command).toBe(process.execPath);
      expect(cmd.args).toContain('serve');
      expect(cmd.source).toBe('installed-cli');
    });

    it('args[0] is a path to the CLI entry file', () => {
      const cmd = getMcpServeCommand({ mode: 'installed', cwd: tmpDir });
      // First arg should be a file path string
      const firstArg = cmd.args[0];
      expect(typeof firstArg).toBe('string');
      expect(firstArg?.length).toBeGreaterThan(0);
    });

    it('returns a non-empty source string', () => {
      const cmd = getMcpServeCommand({ mode: 'installed', cwd: tmpDir });
      expect(cmd.source).toBeTruthy();
      expect(typeof cmd.source).toBe('string');
    });

    it('does NOT include --url when url is not provided', () => {
      const cmd = getMcpServeCommand({ mode: 'installed', cwd: tmpDir });
      expect(cmd.args).not.toContain('--url');
    });

    it('includes --url when provided', () => {
      const cmd = getMcpServeCommand({
        mode: 'installed',
        cwd: tmpDir,
        url: 'http://localhost:4000',
      });
      expect(cmd.args).toContain('--url');
      expect(cmd.args).toContain('http://localhost:4000');
    });

    it('includes --project-root when provided', () => {
      const cmd = getMcpServeCommand({
        mode: 'installed',
        cwd: tmpDir,
        projectRoot: '/some/path',
      });
      expect(cmd.args).toContain('--project-root');
      expect(cmd.args).toContain('/some/path');
    });

    it('does NOT include --project-root when projectRoot is not provided', () => {
      const cmd = getMcpServeCommand({ mode: 'installed', cwd: tmpDir });
      expect(cmd.args).not.toContain('--project-root');
    });
  });

  describe('platform-specific path forms', () => {
    it('win32: installed-mode entry path uses backslash separators', () => {
      if (process.platform === 'win32') {
        const cmd = getMcpServeCommand({ mode: 'installed', cwd: tmpDir });
        expect(cmd.args[0]).toMatch(/\\|^[a-zA-Z]:/);
      } else {
        const cmd = getMcpServeCommand({ mode: 'installed', cwd: tmpDir });
        expect(cmd.args[0]).not.toMatch(/\\[a-zA-Z]/);
      }
    });

    it('posix: installed-mode args use forward-slash paths', () => {
      const cmd = getMcpServeCommand({ mode: 'installed', cwd: tmpDir });
      if (process.platform !== 'win32') {
        expect(cmd.args[0]).not.toMatch(/\\[a-zA-Z]/);
      }
    });
  });
});
