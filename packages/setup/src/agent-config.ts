import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Result } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';
import { type McpServeCommand, getMcpServeCommand } from './command-factory';
import type { AgentConfigInfo } from './types';

export type AgentKind = 'opencode' | 'cursor' | 'claude';

function configError(code: string, message: string) {
  return {
    code,
    category: ErrorCategory.CONFIGURATION,
    severity: ErrorSeverity.RECOVERABLE,
    message,
    correlationId: crypto.randomUUID(),
    subsystem: 'setup-agent-config',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Resolves the agent config path for `kind`. PURE function: no filesystem
 * access. Uses path.win32/path.posix according to `platform` (default
 * process.platform).
 *
 * - opencode: <home>/.config/opencode/opencode.json
 *             (win32: <home>/AppData/Roaming/opencode/opencode.json)
 * - cursor:   <cwd>/.cursor/mcp.json
 * - claude:   <home>/.claude.json
 *             (win32: <home>/AppData/Roaming/Claude/claude_desktop_config.json)
 */
export function resolveAgentConfigPath(
  kind: AgentKind,
  opts?: { cwd?: string; home?: string; platform?: NodeJS.Platform },
): string {
  const platform = opts?.platform ?? process.platform;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const home = opts?.home ?? os.homedir();
  const cwd = opts?.cwd ?? process.cwd();

  switch (kind) {
    case 'opencode': {
      const dir =
        platform === 'win32'
          ? p.join(home, 'AppData', 'Roaming', 'opencode')
          : p.join(home, '.config', 'opencode');
      return p.join(dir, 'opencode.json');
    }
    case 'cursor':
      return p.join(cwd, '.cursor', 'mcp.json');
    case 'claude':
      return platform === 'win32'
        ? p.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
        : p.join(home, '.claude.json');
  }
}

/**
 * Reads an agent config file. `ok(null)` when the file is absent; `err` when
 * it exists but cannot be parsed as a JSON object (never rewritten on error).
 */
export function readAgentConfig(configPath: string): Result<Record<string, unknown> | null> {
  if (!fs.existsSync(configPath)) {
    return ok(null);
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return err(
        configError('AGENT_CONFIG_INVALID', `Agent config is not a JSON object: ${configPath}`),
      );
    }
    return ok(parsed as Record<string, unknown>);
  } catch (e) {
    return err(
      configError(
        'AGENT_CONFIG_INVALID',
        `Failed to parse agent config ${configPath}: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export interface InstallAgentConfigInput {
  kind: AgentKind;
  serveCommand: McpServeCommand;
  cwd?: string;
  home?: string;
  projectRoot?: string;
}

/**
 * Installs (or updates) the Viskod MCP entry in the agent config for `kind`.
 *
 * - Preserves every unrelated key in the existing file.
 * - Adds/updates ONLY the `viskod` entry.
 * - Invalid JSON fails with an error WITHOUT rewriting the file.
 * - Atomic write (tmp file + rename) with the parent directory created.
 * - Idempotent: a second run with identical content returns changed: false
 *   and leaves the file untouched.
 * - `projectRoot` appends `--project-root <root>` to the served args.
 */
export function installAgentConfig(
  input: InstallAgentConfigInput,
): Result<{ path: string; changed: boolean; previous?: unknown }> {
  const configPath = resolveAgentConfigPath(input.kind, { cwd: input.cwd, home: input.home });

  const existing = readAgentConfig(configPath);
  if (!existing.ok) {
    return err(existing.error);
  }

  const config = existing.value ?? {};

  const args = [...input.serveCommand.args];
  // `projectRoot` appends `--project-root <root>` — but only when the
  // serveCommand does not already carry it. Callers that build the command
  // with `getMcpServeCommand({ projectRoot })` AND pass `projectRoot` here
  // would otherwise emit the flag twice.
  if (input.projectRoot !== undefined && !args.includes('--project-root')) {
    args.push('--project-root', input.projectRoot);
  }

  const viskodEntry: Record<string, unknown> =
    input.kind === 'opencode'
      ? {
          type: 'local',
          command: [input.serveCommand.command, ...args],
          enabled: true,
        }
      : {
          command: input.serveCommand.command,
          args,
          env: {},
          disabled: false,
          autoApprove: [],
        };

  const configKey = input.kind === 'opencode' ? 'mcp' : 'mcpServers';
  const mcpSection = config[configKey];
  if (mcpSection === undefined) {
    config[configKey] = {};
  } else if (typeof mcpSection !== 'object' || Array.isArray(mcpSection)) {
    return err(
      configError(
        'AGENT_CONFIG_INVALID',
        `Expected '${configKey}' to be an object in ${configPath}`,
      ),
    );
  }

  const target = config[configKey] as Record<string, unknown>;
  const previous = target.viskod;
  target.viskod = viskodEntry;

  const nextJson = `${JSON.stringify(config, null, 2)}\n`;

  let changed: boolean;
  if (existing.value === null) {
    changed = true;
  } else {
    let currentJson: string;
    try {
      currentJson = fs.readFileSync(configPath, 'utf-8');
    } catch (e) {
      return err(
        configError(
          'AGENT_CONFIG_READ_FAILED',
          `Failed to read agent config ${configPath}: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
    changed = currentJson !== nextJson;
  }

  if (changed) {
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, nextJson, 'utf-8');
      fs.renameSync(tmpPath, configPath);
    } catch (e) {
      return err(
        configError(
          'AGENT_CONFIG_WRITE_FAILED',
          `Failed to write agent config ${configPath}: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  return ok({
    path: configPath,
    changed,
    previous: previous === undefined ? undefined : previous,
  });
}

/**
 * Detects the FIRST existing agent config among the three targets (opencode,
 * cursor, claude) and reports its readiness. Read-only.
 *
 * Accepts either the locked `{ cwd?, home? }` opts form or a legacy bare
 * project root string (treated as cwd) for backward compatibility.
 */
export function checkAgentConfigReadiness(
  opts?: { cwd?: string; home?: string } | string,
): AgentConfigInfo {
  const resolved: { cwd?: string; home?: string } =
    typeof opts === 'string' ? { cwd: opts } : (opts ?? {});

  const home = resolved.home ?? os.homedir();
  const cwd = resolved.cwd ?? process.cwd();

  const targets: Array<{ kind: AgentConfigInfo['kind']; path: string }> = [
    { kind: 'opencode', path: resolveAgentConfigPath('opencode', { home }) },
    { kind: 'cursor', path: resolveAgentConfigPath('cursor', { cwd }) },
    { kind: 'claude-desktop', path: resolveAgentConfigPath('claude', { home }) },
  ];

  for (const target of targets) {
    if (!fs.existsSync(target.path)) continue;
    const read = readAgentConfig(target.path);
    const verified = read.ok && read.value !== null;
    const serveCommand = getMcpServeCommand({ cwd });
    return {
      detected: true,
      kind: target.kind,
      configPath: target.path,
      commandPreview: verified ? [serveCommand.command, ...serveCommand.args].join(' ') : undefined,
      verified,
    };
  }

  return { detected: false, kind: 'unknown', verified: false };
}
