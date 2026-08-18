import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAgentConfig, readAgentConfig, resolveAgentConfigPath } from './agent-config';

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(
    os.tmpdir(),
    `viskod-agent-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe('resolveAgentConfigPath', () => {
  it('opencode on linux → <home>/.config/opencode/opencode.json', () => {
    const result = resolveAgentConfigPath('opencode', {
      home: '/tmp/test-home',
      platform: 'linux',
    });
    expect(result).toBe('/tmp/test-home/.config/opencode/opencode.json');
  });

  it('cursor on linux → <cwd>/.cursor/mcp.json', () => {
    const result = resolveAgentConfigPath('cursor', {
      cwd: '/tmp/test-project',
      platform: 'linux',
    });
    expect(result).toBe('/tmp/test-project/.cursor/mcp.json');
  });

  it('claude on win32 → path containing AppData', () => {
    const result = resolveAgentConfigPath('claude', {
      home: '/tmp/test-home',
      platform: 'win32',
    });
    expect(result).toContain('AppData');
    expect(result).toContain('claude_desktop_config.json');
  });

  it('opencode on win32 → path containing AppData/Roaming', () => {
    const result = resolveAgentConfigPath('opencode', {
      home: '/tmp/test-home',
      platform: 'win32',
    });
    expect(result).toContain('AppData');
    expect(result).toContain('Roaming');
    expect(result).toContain('opencode.json');
  });

  it('claude on linux → <home>/.claude.json', () => {
    const result = resolveAgentConfigPath('claude', {
      home: '/tmp/test-home',
      platform: 'linux',
    });
    expect(result).toBe('/tmp/test-home/.claude.json');
  });
});

describe('readAgentConfig', () => {
  it('returns ok(null) for a non-existent file', () => {
    const result = readAgentConfig(path.join(tmpDir, 'nonexistent.json'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('returns err for invalid JSON', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, 'not-json{{{', 'utf-8');
    const result = readAgentConfig(filePath);
    expect(result.ok).toBe(false);
  });

  it('returns err for a JSON array (not object)', () => {
    const filePath = path.join(tmpDir, 'array.json');
    fs.writeFileSync(filePath, '[1, 2, 3]', 'utf-8');
    const result = readAgentConfig(filePath);
    expect(result.ok).toBe(false);
  });

  it('returns ok with parsed object for valid JSON', () => {
    const filePath = path.join(tmpDir, 'valid.json');
    fs.writeFileSync(filePath, JSON.stringify({ key: 'value' }), 'utf-8');
    const result = readAgentConfig(filePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ key: 'value' });
    }
  });
});

describe('installAgentConfig', () => {
  const serveCommand = {
    command: 'node',
    args: ['/path/to/cli.js', 'serve'],
    mode: 'installed' as const,
    source: 'test',
  };

  function makeOpencodeInput(home: string) {
    return {
      kind: 'opencode' as const,
      serveCommand,
      home,
    };
  }

  function makeCursorInput(cwd: string) {
    return {
      kind: 'cursor' as const,
      serveCommand,
      cwd,
    };
  }

  function makeClaudeInput(home: string) {
    return {
      kind: 'claude' as const,
      serveCommand,
      home,
    };
  }

  describe('opencode config', () => {
    it('file does not exist → creates with correct shape, changed=true', () => {
      const home = path.join(tmpDir, 'opencode-home');
      const result = installAgentConfig(makeOpencodeInput(home));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.changed).toBe(true);
        expect(result.value.path).toContain('opencode.json');
      }

      // Verify the created file
      const configPath = resolveAgentConfigPath('opencode', { home, platform: process.platform });
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(content.mcp).toBeDefined();
      expect(content.mcp.viskod).toBeDefined();
      expect(content.mcp.viskod.type).toBe('local');
      expect(Array.isArray(content.mcp.viskod.command)).toBe(true);
      expect(content.mcp.viskod.command[0]).toBe('node');
      expect(content.mcp.viskod.enabled).toBe(true);
    });

    it('file exists with unrelated keys → preserves them, adds viskod entry', () => {
      const home = path.join(tmpDir, 'opencode-home-exist');
      const configPath = resolveAgentConfigPath('opencode', { home, platform: process.platform });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({ mcp: { otherTool: { type: 'local' } } }, null, 2),
        'utf-8',
      );

      const result = installAgentConfig(makeOpencodeInput(home));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.changed).toBe(true);
      }

      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(content.mcp.otherTool).toEqual({ type: 'local' });
      expect(content.mcp.viskod).toBeDefined();
      expect(content.mcp.viskod.type).toBe('local');
    });

    it('run twice → second run changed=false, content identical', () => {
      const home = path.join(tmpDir, 'opencode-home-idem');
      const result1 = installAgentConfig(makeOpencodeInput(home));
      expect(result1.ok).toBe(true);
      if (result1.ok) expect(result1.value.changed).toBe(true);

      const result2 = installAgentConfig(makeOpencodeInput(home));
      expect(result2.ok).toBe(true);
      if (result2.ok) expect(result2.value.changed).toBe(false);
    });
  });

  describe('cursor config', () => {
    it('file does not exist → creates with correct shape, changed=true', () => {
      const cwd = path.join(tmpDir, 'cursor-project');
      const result = installAgentConfig(makeCursorInput(cwd));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.changed).toBe(true);
      }

      const configPath = resolveAgentConfigPath('cursor', { cwd, platform: process.platform });
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(content.mcpServers).toBeDefined();
      expect(content.mcpServers.viskod).toBeDefined();
      expect(content.mcpServers.viskod.command).toBe('node');
      expect(Array.isArray(content.mcpServers.viskod.args)).toBe(true);
      expect(content.mcpServers.viskod.disabled).toBe(false);
      expect(content.mcpServers.viskod.autoApprove).toEqual([]);
      expect(content.mcpServers.viskod.env).toEqual({});
    });

    it('preserves unrelated keys', () => {
      const cwd = path.join(tmpDir, 'cursor-project-exist');
      const configPath = resolveAgentConfigPath('cursor', { cwd, platform: process.platform });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({ mcpServers: { otherTool: { command: 'x' } } }, null, 2),
        'utf-8',
      );

      const result = installAgentConfig(makeCursorInput(cwd));
      expect(result.ok).toBe(true);

      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(content.mcpServers.otherTool).toEqual({ command: 'x' });
      expect(content.mcpServers.viskod).toBeDefined();
    });
  });

  describe('claude config', () => {
    it('file does not exist → creates with correct shape, changed=true', () => {
      const home = path.join(tmpDir, 'claude-home');
      const result = installAgentConfig(makeClaudeInput(home));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.changed).toBe(true);
      }

      const configPath = resolveAgentConfigPath('claude', { home, platform: process.platform });
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(content.mcpServers).toBeDefined();
      expect(content.mcpServers.viskod).toBeDefined();
      expect(content.mcpServers.viskod.command).toBe('node');
      expect(Array.isArray(content.mcpServers.viskod.args)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('file has invalid JSON → err, file NOT overwritten', () => {
      const cwd = path.join(tmpDir, 'cursor-bad');
      const configPath = resolveAgentConfigPath('cursor', { cwd, platform: process.platform });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, 'NOT_JSON', 'utf-8');

      const result = installAgentConfig(makeCursorInput(cwd));
      expect(result.ok).toBe(false);

      // File should remain unchanged
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toBe('NOT_JSON');
    });

    it('file has existing viskod entry → previous is returned', () => {
      const cwd = path.join(tmpDir, 'cursor-previous');
      const configPath = resolveAgentConfigPath('cursor', { cwd, platform: process.platform });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            mcpServers: { viskod: { command: 'old-command', args: ['old-arg'] } },
          },
          null,
          2,
        ),
        'utf-8',
      );

      const result = installAgentConfig(makeCursorInput(cwd));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.previous).toEqual({
          command: 'old-command',
          args: ['old-arg'],
        });
      }
    });
  });
});
