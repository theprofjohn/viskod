import type { Result, ViskodError } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';

export interface GeneralConfig {
  startupBehavior: 'open-studio' | 'tray-only' | 'headless';
  defaultWorkspace?: string;
}

export interface BrowserConfig {
  defaultBrowser: 'chromium';
  headless: boolean;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  timeout: number;
}

export interface CaptureConfig {
  defaultCaptureType: 'viewport' | 'selection' | 'full-page';
  screenshotFormat: 'png' | 'jpeg';
  screenshotQuality: number;
  autoCapture: boolean;
  retentionDays: number;
}

export interface DiagnosticsConfig {
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  retentionDays: number;
  telemetryEnabled: boolean;
}

export interface PluginsConfig {
  enabledPlugins: string[];
}

export interface ViskodConfig {
  version: string;
  general: GeneralConfig;
  browser: BrowserConfig;
  capture: CaptureConfig;
  diagnostics: DiagnosticsConfig;
  plugins: PluginsConfig;
}

export const DEFAULT_CONFIG: ViskodConfig = {
  version: '1.0.0',
  general: { startupBehavior: 'open-studio' },
  browser: {
    defaultBrowser: 'chromium',
    headless: false,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    timeout: 30000,
  },
  capture: {
    defaultCaptureType: 'viewport',
    screenshotFormat: 'png',
    screenshotQuality: 90,
    autoCapture: false,
    retentionDays: 30,
  },
  diagnostics: {
    logLevel: 'info',
    retentionDays: 7,
    telemetryEnabled: false,
  },
  plugins: { enabledPlugins: [] },
};

export function mergeConfigs(
  cli: Partial<ViskodConfig> = {},
  file: Partial<ViskodConfig> = {},
  env: Partial<ViskodConfig> = {},
  defaults: ViskodConfig = DEFAULT_CONFIG,
): ViskodConfig {
  const result = structuredClone(defaults) as unknown as Record<string, unknown>;
  mergeInto(result, env as unknown as Record<string, unknown>);
  mergeInto(result, file as unknown as Record<string, unknown>);
  mergeInto(result, cli as unknown as Record<string, unknown>);
  return result as unknown as ViskodConfig;
}

function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== null) {
      if (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof target[key] === 'object' &&
        target[key] !== null &&
        !Array.isArray(target[key])
      ) {
        mergeInto(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    }
  }
}

export function validateConfig(config: unknown): Result<ViskodConfig> {
  if (typeof config !== 'object' || config === null) {
    return err(createConfigError('CONFIG_INVALID', 'Config must be an object'));
  }
  const c = config as Record<string, unknown>;

  if (!c.version || typeof c.version !== 'string') {
    return err(createConfigError('CONFIG_VERSION_MISSING', 'Config version is required'));
  }

  if (!c.general || typeof c.general !== 'object') {
    return err(createConfigError('CONFIG_MISSING_SECTION', 'Missing required section: general'));
  }

  if (!c.browser || typeof c.browser !== 'object') {
    return err(createConfigError('CONFIG_MISSING_SECTION', 'Missing required section: browser'));
  }

  return ok(c as unknown as ViskodConfig);
}

function createConfigError(code: string, message: string): ViskodError {
  return {
    code,
    category: ErrorCategory.CONFIGURATION,
    severity: ErrorSeverity.RECOVERABLE,
    message,
    correlationId: crypto.randomUUID(),
    subsystem: 'config',
    timestamp: new Date().toISOString(),
  };
}
