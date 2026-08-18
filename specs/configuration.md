# Configuration

> **Specification ID:** SPEC-004
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Platform Architecture
> **Last Updated:** 2026-07-28

---

## Architecture Sources

- `docs/architecture.md` §Configuration — configuration precedence: CLI flags > project config > environment variables > defaults; configuration must be explicit; avoid hidden behaviour
- `docs/settings.md` — full settings specification: categories, validation, defaults, versioning, migration, performance targets, failure policy
- `docs/ARCHITECTURE_BASELINE.md` — Viskod is a Visual Context Platform; architecture score 94/100; dependency model; runtime boundaries
- `docs/glossary.md` — canonical terminology: Platform, Viskod, Workspace, Configuration, Settings, Validation

A specification with no architecture sources is invalid.

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Draft | Imports base types (`Result`, `Identifier`, `Timestamp`, `Version`, `FilePath`, `Maybe`, `ViskodError`), utility types (`DeepReadonly`), and constants (`SETTINGS_FILE`, `VISKOD_STORAGE_DIR`) |
| SPEC-003 (error-model) | Draft | Uses structured `ViskodError` for all configuration errors; extends error categories with `CONFIGURATION` variant; follows recovery suggestion format |

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| `browser-runtime.md` | Draft | Reads `BrowserConfig` and `CaptureConfig` at startup to configure browser launch, viewport, and capture behaviour |
| `project-scanner.md` | Draft | Reads `ProjectConfig` for workspace root, ignored directories, and framework override |
| `cli.md` | Draft | Parses CLI flags, invokes `loadConfig()`, passes resolved config to all runtime components |
| `studio.md` | Draft | Reads `GeneralConfig` for startup behaviour and workspace; provides Settings UI for persistent configuration |
| `visual-context-engine.md` | Draft | Reads `CaptureConfig` to determine capture defaults and retention policies |
| `capture-pipeline.md` | Draft | Reads `CaptureConfig` for retention days and storage behaviour |
| `diagnostics.md` | Draft | Reads `DiagnosticsConfig` for log level, retention, and telemetry toggle |
| `error-model.md` | Draft | References `CONFIG_VALIDATION_ERROR` and `CONFIG_PARSE_ERROR` as canonical configuration error codes |
| All runtime specifications | Draft | Consume validated `ViskodConfig` at component initialisation; never load config independently |

---

## Purpose

Defines the complete configuration system for the Viskod Visual Context Platform: the configuration schema, precedence rules, load/validate/merge pipeline, state model, migration strategy, and error behaviour. Every configurable value in the platform must be defined here with a concrete type, documented default, valid range, and description. No configuration value may influence behaviour without passing through the validation pipeline defined in this specification.

---

## Scope

- All configuration categories (`general`, `browser`, `capture`, `project`, `diagnostics`, `plugins`)
- Configuration file format (JSON in `.viskod/settings.json`)
- Environment variable to config key mapping
- CLI flag to config key mapping
- Precedence merging: CLI > project config > environment variables > defaults
- Schema versioning and migration between schema versions
- Runtime validation of loaded configuration
- Configuration immutability after loading
- Hot-reload as a config instance replacement operation
- Configuration export and import

---

## Non-Goals

- Runtime state management (belongs to respective subsystem specifications)
- Plugin manifest validation (belongs to `plugin-system.md`)
- Secrets management — config must never store secrets; secrets belong to OS-level credential stores
- Network-delivered configuration or remote config fetching (local-first architecture)
- Per-user global configuration (only per-project `.viskod/settings.json` in Phase 1)
- Configuration UI implementation details (belongs to `studio.md`)

---

## Terminology

| Term | Definition |
|------|-----------|
| Config source | One of four origins for a configuration value: CLI flags, project config file, environment variables, or compiled defaults |
| Precedence | The order in which config sources override each other: CLI > project config > env vars > defaults |
| Config merge | The process of combining values from multiple sources into a single resolved `ViskodConfig` |
| Schema version | The `version` field in `ViskodConfig` that identifies the structure of the configuration (not the product version) |
| Hot-reload | Producing a new validated `ViskodConfig` instance while the platform is running, without restarting the process |
| Config invariant | A guarantee that a valid `ViskodConfig` must uphold (e.g., no secrets in any field, all ranges satisfied) |

All other terms reference `docs/glossary.md`.

---

## Runtime Boundary

| Boundary | Responsibility |
|----------|---------------|
| Process | Loaded synchronously at startup by the CLI; consumed by every subsystem at initialisation |
| Owns | Configuration schema, defaults, validation logic, merge logic, migration logic, config file I/O |
| Forbidden | Secrets storage, business logic, browser automation, network access, subprocess management |

---

## Responsibilities

1. **Define the canonical `ViskodConfig` type** with all sub-types (`GeneralConfig`, `BrowserConfig`, `CaptureConfig`, `ProjectConfig`, `DiagnosticsConfig`, `PluginsConfig`)
2. **Define the precedence order** and enforce it deterministically in the merge function
3. **Validate all configuration** against Zod schemas before any runtime component receives it
4. **Provide defaults** for every configurable value so the platform is operational on first run with zero configuration
5. **Support schema versioning** so configuration can evolve without breaking existing installs
6. **Support migration** between schema versions with deterministic transformations and no silent data loss
7. **Reject invalid configuration** with structured errors containing field-level paths
8. **Guarantee immutability** of a loaded configuration — consumers receive a frozen object
9. **Support hot-reload** by producing a new config instance without mutating the previous one
10. **Never store secrets** in any configuration field

---

## Interfaces

### Public API

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|
| `loadConfig(cliArgs?: Partial<ViskodConfig>, envVars?: Record<string, string>, configPath?: string): Result<ViskodConfig>` | Load, parse, validate, and merge configuration from all sources | CLI args optionally provided; config file may or may not exist at `configPath` (defaults to `.viskod/settings.json`) | Returns `{ ok: true, value: ViskodConfig }` with a frozen, validated, fully-resolved config | `CONFIG_PARSE_ERROR`, `CONFIG_VALIDATION_ERROR`, `CONFIG_MISSING_REQUIRED`, `CONFIG_VERSION_MISMATCH`, `CONFIG_MIGRATION_FAILED` |
| `validateConfig(config: unknown): Result<ViskodConfig>` | Validate an arbitrary object against the full `ViskodConfig` Zod schema | `config` is any serialisable value | Returns `{ ok: true, value: ViskodConfig }` or `{ ok: false, error: ViskodError }` with field-level paths | `CONFIG_VALIDATION_ERROR` |
| `mergeConfigs(cli: Partial<ViskodConfig>, file: Partial<ViskodConfig>, env: Partial<ViskodConfig>, defaults: ViskodConfig): ViskodConfig` | Merge four partial configs by precedence, returning a fully-resolved config (not validated — call `validateConfig` separately) | None (all inputs may be empty partials); `defaults` must be a complete `ViskodConfig` | Returns a deep-merged `ViskodConfig` object; output is not yet validated and not frozen | None — merge is a pure function; validation errors belong to `validateConfig` |
| `migrateConfig(config: unknown, fromVersion: string, toVersion: string): Result<ViskodConfig>` | Transform a config from one schema version to another | `config` matches the `fromVersion` schema | Returns `{ ok: true, value: ViskodConfig }` conforming to `toVersion` schema | `CONFIG_MIGRATION_FAILED` if no migration path exists or transformation fails |
| `loadDefaults(): ViskodConfig` | Return the compiled-in default configuration | None | Returns a frozen `ViskodConfig` with all defaults populated | None — defaults are compiled |
| `exportConfig(config: ViskodConfig): string` | Serialise a valid config to a formatted JSON string (without comments) | `config` is a validated `ViskodConfig` | Returns a pretty-printed, sorted-key JSON string | None — serialisation of a validated object is deterministic |
| `reloadConfig(previousConfig: ViskodConfig, configPath?: string): Result<ViskodConfig>` | Hot-reload: re-read the config file, re-validate, return a new instance | `previousConfig` is the currently active validated config | Returns a new frozen `ViskodConfig` or the previous config on validation failure (never leaves platform config-less) | `CONFIG_PARSE_ERROR`, `CONFIG_VALIDATION_ERROR` — on error, the platform continues with `previousConfig` |

### Events Published

N/A — the configuration module does not publish events. Subsystems that consume config changes should poll or receive the new config via their initialisation.

### Events Subscribed

N/A — the configuration module does not subscribe to events. It is a pure load-validate-merge pipeline with no reactive behaviour.

---

## Data Models

### General Settings

```typescript
interface GeneralConfig {
  startupBehavior: 'open-studio' | 'tray-only' | 'headless';
  defaultWorkspace?: string;
}
```

| Field | Type | Default | Range / Valid Values | Description |
|-------|------|---------|---------------------|-------------|
| `startupBehavior` | `'open-studio' \| 'tray-only' \| 'headless'` | `'open-studio'` | One of three string literals | Controls what happens after the CLI starts the platform |
| `defaultWorkspace` | `string` (optional) | `undefined` | Any non-empty string; must be a valid `FilePath` | Path to the default workspace to open on startup |

### Browser Settings

```typescript
interface BrowserConfig {
  defaultBrowser: 'chromium';
  headless: boolean;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  timeout: number;
}
```

| Field | Type | Default | Range / Valid Values | Description |
|-------|------|---------|---------------------|-------------|
| `defaultBrowser` | `'chromium'` | `'chromium'` | `'chromium'` only in Phase 1 | The browser engine to use for inspection |
| `headless` | `boolean` | `false` | `true` or `false` | Whether to launch the browser in headless mode |
| `viewport.width` | `number` | `1280` | Integer, 320–7680 | Default viewport width in CSS pixels |
| `viewport.height` | `number` | `720` | Integer, 240–4320 | Default viewport height in CSS pixels |
| `deviceScaleFactor` | `number` | `1` | `0.5`–`3.0` inclusive | Device pixel ratio for rendering |
| `timeout` | `number` | `30000` | Integer, 5000–120000 (ms) | Default timeout for browser operations |

### Capture Settings

```typescript
interface CaptureConfig {
  defaultCaptureType: 'viewport' | 'selection' | 'full-page';
  screenshotFormat: 'png' | 'jpeg';
  screenshotQuality: number;
  autoCapture: boolean;
  retentionDays: number;
}
```

| Field | Type | Default | Range / Valid Values | Description |
|-------|------|---------|---------------------|-------------|
| `defaultCaptureType` | `'viewport' \| 'selection' \| 'full-page'` | `'viewport'` | One of three string literals | The capture scope when no explicit type is specified |
| `screenshotFormat` | `'png' \| 'jpeg'` | `'png'` | One of two string literals | Output image format for screenshots |
| `screenshotQuality` | `number` | `90` | Integer, 1–100 | JPEG quality (applies only when format is `'jpeg'`); ignored for PNG |
| `autoCapture` | `boolean` | `false` | `true` or `false` | Whether to automatically capture on selection change |
| `retentionDays` | `number` | `30` | Integer, 0–365; `0` means keep forever | Number of days to retain captures before cleanup |

### Project Settings

```typescript
interface ProjectConfig {
  workspaceRoot: string;
  ignoredDirectories: string[];
  frameworkOverride?: string;
}
```

| Field | Type | Default | Range / Valid Values | Description |
|-------|------|---------|---------------------|-------------|
| `workspaceRoot` | `string` | **Required** | Non-empty string; must be a valid `FilePath` | Root directory of the project workspace |
| `ignoredDirectories` | `string[]` | `['node_modules', '.git', 'dist', '.next', 'build']` | Array of non-empty strings | Directory names to exclude from project scanning |
| `frameworkOverride` | `string` (optional) | `undefined` | Any non-empty string | Override auto-detected framework (e.g., `'react'`, `'next'`, `'vue'`) |

### Diagnostics Settings

```typescript
interface DiagnosticsConfig {
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  retentionDays: number;
  telemetryEnabled: boolean;
}
```

| Field | Type | Default | Range / Valid Values | Description |
|-------|------|---------|---------------------|-------------|
| `logLevel` | `'trace' \| 'debug' \| 'info' \| 'warn' \| 'error'` | `'info'` | One of five string literals | Minimum log level emitted by the platform |
| `retentionDays` | `number` | `7` | Integer, 1–90 | Number of days to retain diagnostic logs |
| `telemetryEnabled` | `boolean` | `false` | `true` or `false` | Whether platform telemetry is enabled (defaults to `false` per constitution) |

### Plugin Settings

```typescript
interface PluginsConfig {
  enabledPlugins: string[];
}
```

| Field | Type | Default | Range / Valid Values | Description |
|-------|------|---------|---------------------|-------------|
| `enabledPlugins` | `string[]` | `[]` | Array of non-empty strings (plugin identifiers) | List of plugin identifiers to load at startup |

### Full Configuration

```typescript
interface ViskodConfig {
  version: string;
  general: GeneralConfig;
  browser: BrowserConfig;
  capture: CaptureConfig;
  project: ProjectConfig;
  diagnostics: DiagnosticsConfig;
  plugins: PluginsConfig;
}
```

| Field | Type | Default | Range / Valid Values | Description |
|-------|------|---------|---------------------|-------------|
| `version` | `string` | `'1.0'` | Semver string matching `${number}.${number}.${number}` | Schema version of the configuration file, used for migration |
| `general` | `GeneralConfig` | See §General Settings | Valid `GeneralConfig` | General platform behaviour settings |
| `browser` | `BrowserConfig` | See §Browser Settings | Valid `BrowserConfig` | Browser launch and viewport settings |
| `capture` | `CaptureConfig` | See §Capture Settings | Valid `CaptureConfig` | Screenshot and capture behaviour settings |
| `project` | `ProjectConfig` | See §Project Settings | Valid `ProjectConfig` | Project workspace and scanning settings |
| `diagnostics` | `DiagnosticsConfig` | See §Diagnostics Settings | Valid `DiagnosticsConfig` | Logging and diagnostic settings |
| `plugins` | `PluginsConfig` | See §Plugin Settings | Valid `PluginsConfig` | Plugin loading settings |

### Zod Schemas

Every interface above must have a corresponding Zod schema for runtime validation. Schemas are imported from `@viskod/shared` where base types are shared; configuration-specific schemas are defined in `packages/config/`.

```typescript
import { z } from 'zod';
import { VersionSchema } from '@viskod/shared';

const GeneralConfigSchema = z.object({
  startupBehavior: z.enum(['open-studio', 'tray-only', 'headless']).default('open-studio'),
  defaultWorkspace: z.string().min(1).optional(),
});

const BrowserConfigSchema = z.object({
  defaultBrowser: z.literal('chromium').default('chromium'),
  headless: z.boolean().default(false),
  viewport: z.object({
    width: z.number().int().min(320).max(7680).default(1280),
    height: z.number().int().min(240).max(4320).default(720),
  }).default({ width: 1280, height: 720 }),
  deviceScaleFactor: z.number().min(0.5).max(3.0).default(1),
  timeout: z.number().int().min(5000).max(120000).default(30000),
});

const CaptureConfigSchema = z.object({
  defaultCaptureType: z.enum(['viewport', 'selection', 'full-page']).default('viewport'),
  screenshotFormat: z.enum(['png', 'jpeg']).default('png'),
  screenshotQuality: z.number().int().min(1).max(100).default(90),
  autoCapture: z.boolean().default(false),
  retentionDays: z.number().int().min(0).max(365).default(30),
});

const ProjectConfigSchema = z.object({
  workspaceRoot: z.string().min(1),
  ignoredDirectories: z.array(z.string().min(1)).default(['node_modules', '.git', 'dist', '.next', 'build']),
  frameworkOverride: z.string().min(1).optional(),
});

const DiagnosticsConfigSchema = z.object({
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  retentionDays: z.number().int().min(1).max(90).default(7),
  telemetryEnabled: z.boolean().default(false),
});

const PluginsConfigSchema = z.object({
  enabledPlugins: z.array(z.string().min(1)).default([]),
});

const ViskodConfigSchema = z.object({
  version: VersionSchema.default('1.0'),
  general: GeneralConfigSchema,
  browser: BrowserConfigSchema,
  capture: CaptureConfigSchema,
  project: ProjectConfigSchema,
  diagnostics: DiagnosticsConfigSchema,
  plugins: PluginsConfigSchema,
});
```

### Environment Variable Mapping

Environment variables are mapped to config keys using the `VISKOD_` prefix, with double-underscore separators for nested keys.

| Environment Variable | Config Path | Type | Description |
|---------------------|-------------|------|-------------|
| `VISKOD_GENERAL__STARTUP_BEHAVIOR` | `general.startupBehavior` | `string` | Startup behaviour override |
| `VISKOD_GENERAL__DEFAULT_WORKSPACE` | `general.defaultWorkspace` | `string` | Default workspace path |
| `VISKOD_BROWSER__HEADLESS` | `browser.headless` | `'true' \| 'false'` | Headless mode |
| `VISKOD_BROWSER__VIEWPORT_WIDTH` | `browser.viewport.width` | integer string | Viewport width |
| `VISKOD_BROWSER__VIEWPORT_HEIGHT` | `browser.viewport.height` | integer string | Viewport height |
| `VISKOD_BROWSER__DEVICE_SCALE_FACTOR` | `browser.deviceScaleFactor` | decimal string | Device scale factor |
| `VISKOD_BROWSER__TIMEOUT` | `browser.timeout` | integer string | Browser timeout (ms) |
| `VISKOD_CAPTURE__DEFAULT_CAPTURE_TYPE` | `capture.defaultCaptureType` | `string` | Default capture scope |
| `VISKOD_CAPTURE__SCREENSHOT_FORMAT` | `capture.screenshotFormat` | `'png' \| 'jpeg'` | Screenshot format |
| `VISKOD_CAPTURE__SCREENSHOT_QUALITY` | `capture.screenshotQuality` | integer string | JPEG quality |
| `VISKOD_CAPTURE__AUTO_CAPTURE` | `capture.autoCapture` | `'true' \| 'false'` | Auto-capture toggle |
| `VISKOD_CAPTURE__RETENTION_DAYS` | `capture.retentionDays` | integer string | Capture retention |
| `VISKOD_PROJECT__WORKSPACE_ROOT` | `project.workspaceRoot` | `string` | Workspace root path |
| `VISKOD_PROJECT__IGNORED_DIRECTORIES` | `project.ignoredDirectories` | comma-separated string | Ignored directory names |
| `VISKOD_PROJECT__FRAMEWORK_OVERRIDE` | `project.frameworkOverride` | `string` | Framework override |
| `VISKOD_DIAGNOSTICS__LOG_LEVEL` | `diagnostics.logLevel` | `string` | Log level |
| `VISKOD_DIAGNOSTICS__RETENTION_DAYS` | `diagnostics.retentionDays` | integer string | Diagnostics retention |
| `VISKOD_DIAGNOSTICS__TELEMETRY_ENABLED` | `diagnostics.telemetryEnabled` | `'true' \| 'false'` | Telemetry toggle |
| `VISKOD_PLUGINS__ENABLED_PLUGINS` | `plugins.enabledPlugins` | comma-separated string | Enabled plugin IDs |

String-to-type coercion for env vars:
- `'true'` / `'false'` → `boolean`
- Integer-only strings → `number` (integer)
- Decimal strings → `number`
- Comma-separated strings → `string[]` (trim whitespace from each element)
- All other strings remain `string`

---

## State Model

```
        ┌──────────┐
        │ Unloaded │
        └────┬─────┘
             │ loadConfig() called
             ▼
        ┌──────────┐
        │ Loading  │
        └────┬─────┘
             │ file read + parse complete
             ▼
        ┌─────────────┐
        │ Validating  │
        └──┬──────┬───┘
           │      │ validation fails
           │      ▼
           │  ┌───────────────────┐
           │  │ ValidationFailed  │
           │  └─────────┬─────────┘
           │            │ corrected config provided
           │            ▼
           │  ┌─────────────┐
           │  │  Loading    │  (re-entry)
           │  └─────────────┘
           │
           │ validation succeeds
           ▼
        ┌──────────┐
        │ Loaded   │◄──────── hot-reload produces new instance
        └──────────┘          (previous instance discarded, new one frozen)
```

### Invariants

1. A `ViskodConfig` in the `Loaded` state is always validated, fully-resolved (no optional fields remain `undefined` except where the schema allows), and deeply frozen (`DeepReadonly<ViskodConfig>`).
2. The platform must never be left without a valid configuration. If `reloadConfig()` fails, the previous config remains active.
3. Configuration is immutable after loading. No consumer may mutate a loaded config.
4. Hot-reload produces a completely new config instance — it never mutates the existing one.
5. Invalid configuration must never be persisted to `.viskod/settings.json`.

### Lifecycle

```
CLI startup
  │
  ├── parse CLI flags → Partial<ViskodConfig>
  │
  ├── read .viskod/settings.json (if exists) → Partial<ViskodConfig>
  │
  ├── read VISKOD_* environment variables → Partial<ViskodConfig>
  │
  ├── loadDefaults() → ViskodConfig (compiled defaults)
  │
  ├── mergeConfigs(cli, file, env, defaults) → Partial merge result
  │
  ├── validateConfig(merged) → Result<ViskodConfig>
  │      │
  │      ├── on failure: report CONFIG_VALIDATION_ERROR, exit with code 2
  │      │
  │      └── on success: freeze config, distribute to subsystems
  │
  └── Platform starts with validated ViskodConfig
```

---

## Command Flows

### `loadConfig()` — Full Startup Flow

```
CLI ──calls──→ loadConfig(cliArgs, envVars, configPath)
                  │
                  ├── 1. Read config file ←──→ filesystem
                  │      │
                  │      ├── file missing → Partial config is empty {}
                  │      ├── file exists → parse JSON
                  │      │      │
                  │      │      ├── JSON parse error → return CONFIG_PARSE_ERROR
                  │      │      │
                  │      │      └── parse succeeds → Partial config
                  │      │
                  │      └── version mismatch detected
                  │             │
                  │             ├── no migration path → return CONFIG_VERSION_MISMATCH
                  │             └── migration path exists
                  │                    │
                  │                    ├── migrateConfig() succeeds → migrated partial config
                  │                    └── migrateConfig() fails → return CONFIG_MIGRATION_FAILED
                  │
                  ├── 2. Parse environment variables → Partial<ViskodConfig>
                  │      (VISKOD_* vars with type coercion)
                  │
                  ├── 3. loadDefaults() → ViskodConfig
                  │
                  ├── 4. mergeConfigs(cliArgs, file, env, defaults) → merged object
                  │
                  ├── 5. validateConfig(merged) 
                  │      │
                  │      ├── passes → freeze → return { ok: true, value: frozenConfig }
                  │      └── fails  → return { ok: false, error: ViskodError with field paths }
                  │
                  └── return Result<ViskodConfig>
```

### `reloadConfig()` — Hot-Reload Flow

```
Caller ──calls──→ reloadConfig(previousConfig, configPath)
                     │
                     ├── 1. Read config file (same as loadConfig step 1)
                     │
                     ├── 2. validateConfig(reloadedConfig)
                     │      │
                     │      ├── passes → freeze → return { ok: true, value: newFrozenConfig }
                     │      └── fails  → log warning, return { ok: false, error }
                     │
                     └── Platform continues with previousConfig on failure
```

### `migrateConfig()` — Migration Flow

```
Caller ──calls──→ migrateConfig(config, fromVersion, toVersion)
                     │
                     ├── 1. Lookup migration chain: fromVersion → ... → toVersion
                     │      │
                     │      ├── no chain found → return CONFIG_MIGRATION_FAILED
                     │      └── chain found
                     │             │
                     │             └── 2. Apply each migration step sequentially
                     │                    │
                     │                    ├── any step fails → return CONFIG_MIGRATION_FAILED
                     │                    └── all steps succeed → return migrated config
                     │
                     └── return Result<ViskodConfig>
```

---

## Event Flows

N/A — the configuration module has no event-driven behaviour. It is a synchronous load-validate-merge pipeline. Subsystem reconfiguration on hot-reload is the responsibility of each subsystem's initialisation logic, which re-validates its internal state against the new config instance.

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| `.viskod/settings.json` contains invalid JSON | `CONFIG_PARSE_ERROR` | `"Failed to parse configuration file at <path>: <JSON parse error message>"` | Fix the JSON syntax in the config file and retry |
| Config file is valid JSON but fails schema validation | `CONFIG_VALIDATION_ERROR` | `"Configuration validation failed: <field path>: <Zod error message>"` for each offending field | Correct the invalid field(s) in the config file; error includes the exact field path |
| Required field `project.workspaceRoot` is missing after merge | `CONFIG_MISSING_REQUIRED` | `"Required configuration field 'project.workspaceRoot' is missing"` | Provide `workspaceRoot` via CLI flag, config file, or `VISKOD_PROJECT__WORKSPACE_ROOT` env var |
| Config file `version` does not match current schema version and no migration exists | `CONFIG_VERSION_MISMATCH` | `"Configuration version <from> is incompatible with current version <to>. No migration path available."` | Delete or manually upgrade the config file; automatic migration is not possible |
| Migration from `<fromVersion>` to `<toVersion>` fails | `CONFIG_MIGRATION_FAILED` | `"Failed to migrate configuration from version <from> to <to>: <cause>"` | Inspect the migration error, manually correct the config, or delete it to start fresh with defaults |
| Config file path is inaccessible (permissions) | `CONFIG_READ_ERROR` | `"Cannot read configuration file at <path>: <OS error>"` | Check file permissions; the platform can continue with defaults + CLI/env overrides |
| Config file path is a directory, not a file | `CONFIG_READ_ERROR` | `"Configuration path <path> is a directory, expected a file"` | Remove or rename the directory; the platform can continue with defaults + CLI/env overrides |
| Environment variable contains invalid type (e.g., `VISKOD_BROWSER__TIMEOUT=abc`) | `CONFIG_VALIDATION_ERROR` | `"Environment variable VISKOD_BROWSER__TIMEOUT: expected integer, got 'abc'"` | Correct the environment variable value |
| `deviceScaleFactor` set to value outside 0.5–3.0 range | `CONFIG_VALIDATION_ERROR` | `"Configuration validation failed: browser.deviceScaleFactor: must be between 0.5 and 3.0, got <value>"` | Set a value within the valid range |
| `logLevel` set to unknown value | `CONFIG_VALIDATION_ERROR` | `"Configuration validation failed: diagnostics.logLevel: must be one of [trace, debug, info, warn, error], got '<value>'"` | Choose one of the five valid log levels |

All configuration errors use `ErrorCategory.CONFIGURATION` (defined in this specification, extending the base categories from SPEC-002) and `ErrorSeverity.CRITICAL` for missing required fields, `ErrorSeverity.RECOVERABLE` for parse/migration failures (platform can fall back to defaults).

### Error Category Extension

This specification extends the `ErrorCategory` enum defined in SPEC-002 (`shared-types.md`) by adding:

```typescript
// In packages/config/src/errors.ts
import { ErrorCategory as BaseErrorCategory } from '@viskod/shared';

const ErrorCategory = {
  ...BaseErrorCategory,
  CONFIGURATION: 'configuration',
} as const;
```

The `CONFIGURATION` category is reserved for errors originating from the configuration subsystem. This extension does not modify SPEC-002 — it composes with it.

---

## Security Requirements

- **No secrets in configuration:** No configuration field shall store passwords, API keys, tokens, cookies, certificates, private keys, or any credential material. The Zod schemas must not define fields that encourage secret storage.
- **No secrets in env vars:** The environment variable mapping layer must never map environment variables that are not explicitly listed in §Data Models > Environment Variable Mapping. This prevents accidental ingestion of `VISKOD_*` vars that developers might set with sensitive values.
- **File path validation:** All `FilePath` values (e.g., `defaultWorkspace`, `workspaceRoot`) must be validated as safe paths. The validation layer must reject paths containing null bytes, paths that traverse outside the project root (`../` escaping), and paths with non-printable characters.
- **Config file permissions:** The configuration loader should warn if `.viskod/settings.json` has world-readable permissions on POSIX systems.
- **Config file integrity:** The config file must never be written with secrets inadvertently. The `exportConfig()` function serialises only the validated config object — it cannot inject values that were not already validated.
- **Input validation for all external config sources:** CLI args, config file contents, and environment variables are all untrusted input. Every value must pass through `validateConfig()`.
- **No network access:** The configuration module must never fetch configuration from a remote source. This is a local-first platform.

---

## Privacy Requirements

- **Telemetry defaults to `false`:** The `diagnostics.telemetryEnabled` field defaults to `false`. No data is collected without explicit opt-in.
- **No configuration telemetry:** Even when telemetry is enabled, the platform must never transmit the contents of `.viskod/settings.json` or any individual configuration value. Only aggregate platform behaviour metrics may be collected.
- **No tracking of config changes:** The platform must not record a history of configuration changes for transmission. Local config file history is the operating system's responsibility.
- **No PII in config:** Configuration fields must not solicit or store personally identifiable information.
- **Config export must warn:** When exporting configuration via `exportConfig()`, the caller should be informed that the exported JSON may contain workspace paths that reveal directory structure.

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Config file read + JSON parse (cold) | < 5 ms | `performance.now()` around `fs.readFileSync` + `JSON.parse` for a 10 KB config file |
| Schema validation (`validateConfig`) | < 5 ms | `performance.now()` around `ViskodConfigSchema.parse()` for a valid config |
| Config merge (`mergeConfigs`) | < 2 ms | `performance.now()` around merge of four partial configs (each ~10 fields) |
| `loadConfig()` end-to-end (no migration) | < 10 ms | `performance.now()` around full `loadConfig()` call excluding file read |
| `loadConfig()` end-to-end (with migration, 3 steps) | < 20 ms | `performance.now()` around full `loadConfig()` with migration chain |
| `reloadConfig()` without migration | < 10 ms | `performance.now()` around `reloadConfig()` with valid config file |
| Schema instantiation (all Zod schemas) | < 3 ms | `performance.now()` around `require('@viskod/config')` schema module load |

These budgets apply to the configuration module in isolation. File I/O time is excluded from computation budgets but included in end-to-end budgets.

---

## Observability

- **Log event: `config.loaded`** — emitted after a successful `loadConfig()` or `reloadConfig()`. Includes schema version, source counts (CLI flags present, config file path, env var count), and load duration.
- **Log event: `config.validation_failed`** — emitted when `validateConfig()` rejects input. Includes field-level error paths and the offending values (with sensitive values redacted — numbers and enums are safe to log; string values are truncated to 40 characters).
- **Log event: `config.migrated`** — emitted when `migrateConfig()` succeeds. Includes from-version, to-version, and migration duration.
- **Log event: `config.hot_reloaded`** — emitted when `reloadConfig()` succeeds. Includes the new schema version.
- **Log event: `config.hot_reload_failed`** — emitted when `reloadConfig()` fails. Includes the error and confirms the platform is continuing with the previous config.
- **Diagnostic metric: `config.load_duration_ms`** — gauge metric for the last `loadConfig()` duration.
- **Diagnostic metric: `config.validation_duration_ms`** — gauge metric for the last `validateConfig()` duration.
- **Diagnostic metric: `config.frozen`** — boolean gauge; `true` when the active config is frozen.

---

## Configuration

This specification defines the configuration system itself. The configuration module has no configurable behaviour beyond what it loads — it is bootstrapped from compiled defaults.

The compiled defaults are defined in `packages/config/src/defaults.ts` and imported at module initialisation. These defaults are the values listed in §Data Models. They must not be overridable by configuration — they are the foundation that configuration layers upon.

Default values are frozen at compile time. Any change to a default value requires:
1. A version increment of the configuration module
2. Documentation in the migration guide
3. A decision record in `/decisions/`

---

## Failure and Recovery

**What happens when the configuration module fails:**

- **`loadConfig()` fails:** The CLI reports the structured error and exits with code 2. The platform does not start without valid configuration. The developer must correct the config file, CLI args, or environment variables and retry.
- **`validateConfig()` fails at startup:** Same as `loadConfig()` failure — the platform does not start.
- **`reloadConfig()` fails at runtime:** The platform logs a warning, continues with the previous valid configuration, and exposes the error via diagnostics. No subsystem is restarted with invalid config.
- **Config file is deleted while platform is running:** The next `reloadConfig()` will start with an empty file partial, falling through to env vars and defaults. This may produce a valid config (if `workspaceRoot` is provided via CLI/env) or fail (if `workspaceRoot` is missing). The platform continues with the previous config on failure.
- **Config file is corrupted while platform is running:** Same recovery as deletion — previous config remains active.

**Subsystem recovery after hot-reload:**

Each subsystem that consumes configuration must support receiving a new `ViskodConfig` instance. The subsystem is responsible for:
1. Comparing the new config to the previous one
2. Applying relevant changes (e.g., new log level, new viewport size)
3. Discarding the old config reference
4. Operating on the new frozen config

Subsystems must not cache configuration values beyond the lifecycle of a config instance.

---

## Compatibility

### Breaking-Change Policy

A change to the configuration schema is considered breaking if it:

1. Removes or renames a top-level config section (`general`, `browser`, `capture`, `project`, `diagnostics`, `plugins`)
2. Removes or renames a field within any config section
3. Adds a required field to any config section without a default value
4. Removes a valid value from an enum (e.g., removing `'tray-only'` from `startupBehavior`)
5. Tightens a range such that previously valid values become invalid (e.g., `timeout` max from 120000 to 60000)
6. Changes the type of any field
7. Changes the `version` field semantics (e.g., from semver to integer)

### Migration Strategy

Every breaking change requires:

1. A new schema version (`version` field increment in `ViskodConfig`)
2. A migration function registered in the migration chain
3. A migration guide documenting the change, rationale, and upgrade steps
4. Backwards-compatible reading: the config loader must be able to read the previous version and migrate it forward
5. A decision record in `/decisions/` documenting the rationale

### Deprecation Window

- Non-breaking additions (new optional fields, new config sections): no deprecation window required, available immediately
- Breaking changes: the previous schema version must be readable with automatic migration for at least one major product version
- Emergency security fixes (e.g., removing a field that could leak secrets): may bypass the deprecation window with documented justification

---

## Testing Requirements

### Unit Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| `ViskodConfigSchema` parses valid complete config | Happy path | Parsed `ViskodConfig` returned |
| `ViskodConfigSchema` rejects config missing required `project.workspaceRoot` | Invalid input | `ZodError` with path `['project', 'workspaceRoot']` |
| `ViskodConfigSchema` rejects `deviceScaleFactor` below 0.5 | Range violation | `ZodError` with path `['browser', 'deviceScaleFactor']` |
| `ViskodConfigSchema` rejects `deviceScaleFactor` above 3.0 | Range violation | `ZodError` with path `['browser', 'deviceScaleFactor']` |
| `ViskodConfigSchema` rejects `timeout` below 5000 | Range violation | `ZodError` with path `['browser', 'timeout']` |
| `ViskodConfigSchema` rejects `timeout` above 120000 | Range violation | `ZodError` with path `['browser', 'timeout']` |
| `ViskodConfigSchema` rejects `screenshotQuality` below 1 | Range violation | `ZodError` with path `['capture', 'screenshotQuality']` |
| `ViskodConfigSchema` rejects `screenshotQuality` above 100 | Range violation | `ZodError` with path `['capture', 'screenshotQuality']` |
| `ViskodConfigSchema` rejects `retentionDays` below 0 (except diagnostics which is min 1) | Range violation | `ZodError` with path `['capture', 'retentionDays']` |
| `ViskodConfigSchema` rejects unknown `logLevel` | Enum violation | `ZodError` with path `['diagnostics', 'logLevel']` |
| `ViskodConfigSchema` rejects unknown `startupBehavior` | Enum violation | `ZodError` with path `['general', 'startupBehavior']` |
| `ViskodConfigSchema` rejects non-integer `timeout` | Type violation | `ZodError` with path `['browser', 'timeout']` |
| `ViskodConfigSchema` rejects empty `workspaceRoot` | String violation | `ZodError` with path `['project', 'workspaceRoot']` |
| `ViskodConfigSchema` rejects `defaultBrowser` other than `'chromium'` | Literal violation | `ZodError` with path `['browser', 'defaultBrowser']` |
| `ViskodConfigSchema` fills all defaults when given an empty object except required fields | Default population | All defaults populated; `workspaceRoot` error reported |
| `ViskodConfigSchema` accepts `retentionDays` of 0 for capture (keep forever) | Edge case | Parsed successfully with `retentionDays: 0` |
| `ViskodConfigSchema` rejects `retentionDays` of 0 for diagnostics (min is 1) | Edge case | `ZodError` with path `['diagnostics', 'retentionDays']` |
| `ViskodConfigSchema` accepts `viewport.width` at boundary 320 | Edge case | Parsed successfully |
| `ViskodConfigSchema` accepts `viewport.width` at boundary 7680 | Edge case | Parsed successfully |
| `ViskodConfigSchema` rejects `viewport.width` at 319 | Edge case | `ZodError` with path `['browser', 'viewport', 'width']` |

### Integration Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| `loadConfig()` with no CLI args, no config file, no env vars, relying on defaults | Startup without any config | Defaults loaded; `CONFIG_MISSING_REQUIRED` for `workspaceRoot` |
| `loadConfig()` with config file only, containing valid complete config | File loading | Config loaded and validated |
| `loadConfig()` with config file containing invalid JSON | Parse error | `CONFIG_PARSE_ERROR` returned with file path |
| `loadConfig()` with config file containing extra unknown fields | Strict parsing | Unknown fields are stripped by Zod (`.strict()`); config parsed and defaults filled |
| `mergeConfigs()` with all four sources providing overlapping values | Precedence | CLI overrides file; file overrides env; env overrides defaults |
| `mergeConfigs()` with CLI providing `headless: true`, file providing `headless: false` | CLI precedence | Result has `headless: true` |
| `mergeConfigs()` with env providing `VISKOD_BROWSER__HEADLESS=true`, default `false` | Env precedence | Result has `headless: true` |
| `mergeConfigs()` deep-merges nested objects (e.g., CLI provides `viewport.width` only, file provides full `viewport`) | Deep merge | Only the specified nested field is overridden; other nested fields come from lower precedence |
| `migrateConfig()` from version `1.0` to `1.1` with a registered migration | Migration | Config transformed correctly; all existing values preserved where compatible |
| `migrateConfig()` from version `1.0` to `2.0` with no migration registered | Version mismatch | `CONFIG_VERSION_MISMATCH` returned |
| `reloadConfig()` with a newly valid config file | Hot-reload | New config instance returned; previous config unchanged |
| `reloadConfig()` with a newly invalid config file | Hot-reload failure | Error returned; platform continues with previous config |
| `loadConfig()` with env var `VISKOD_PROJECT__IGNORED_DIRECTORIES=foo, bar, baz` | Array coercion | `ignoredDirectories` is `['foo', 'bar', 'baz']` |
| `loadConfig()` with env var `VISKOD_BROWSER__TIMEOUT=abc` | Type coercion failure | `CONFIG_VALIDATION_ERROR` with the env var name in message |

### Contract Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| Config schema matches `docs/settings.md` §Settings Categories | Cross-document contract | Every settings category in the design document maps to a config section in `ViskodConfig` |
| Config schema version matches `docs/architecture.md` §Configuration | Cross-document contract | The `version` field semantics match the architecture document |
| All exported interfaces have corresponding Zod schemas | Contract integrity | Every `*Config` interface has a `*ConfigSchema` Zod schema |
| `SETTINGS_FILE` constant from `@viskod/shared` matches config file path | Cross-package contract | Config loader reads from path matching `packages/shared` constant |
| `VISKOD_STORAGE_DIR` constant from `@viskod/shared` matches storage root | Cross-package contract | Config file path is relative to `VISKOD_STORAGE_DIR` |

### End-to-End Acceptance Criteria

| Test | Scope | Expected Result |
|------|-------|----------------|
| Platform starts with only `VISKOD_PROJECT__WORKSPACE_ROOT` set | Minimal env var startup | Browser launches, Studio opens, all subsystems initialise with defaults |
| Platform starts with valid `.viskod/settings.json` | Config file startup | Config loaded, precedence respected, no warnings |
| Platform exits with code 2 on invalid config file | Error exit | Structured error printed to stderr, platform does not start |
| Platform starts with config from previous major version and migrates successfully | Migration | Config migrated, platform starts, migrated values preserved |
| Platform starts, user edits config file, `reloadConfig()` called, new log level takes effect | Hot-reload | Diagnostics subsystem receives new log level, log verbosity changes without restart |
| Export config, delete config file, import config — platform starts identically | Export/import round-trip | Behaviour before export matches behaviour after import |

---

## Acceptance Criteria

- [ ] All config sections (`general`, `browser`, `capture`, `project`, `diagnostics`, `plugins`) defined with concrete TypeScript interfaces
- [ ] Every configurable value has a documented default, valid range, and description (in §Data Models tables)
- [ ] Precedence order verified by integration tests: CLI > project config > env vars > defaults
- [ ] `mergeConfigs()` produces correct deep-merged results for overlapping keys across all four sources
- [ ] Invalid config rejected by `validateConfig()` with field-level error paths (Zod `ZodError` mapped to structured `ViskodError`)
- [ ] `CONFIG_PARSE_ERROR` returned for malformed JSON files
- [ ] `CONFIG_VALIDATION_ERROR` returned for schema-violating configs with offending field paths
- [ ] `CONFIG_MISSING_REQUIRED` returned when `project.workspaceRoot` is absent
- [ ] `CONFIG_VERSION_MISMATCH` returned when no migration path exists
- [ ] `CONFIG_MIGRATION_FAILED` returned when a migration step fails
- [ ] Config migration (`migrateConfig()`) preserves values where compatible with the target schema
- [ ] No secrets in any config field definition — no field accepts passwords, tokens, keys, or credentials
- [ ] All `FILEPATH` values validated to reject path traversal, null bytes, and non-printable characters
- [ ] Config file read from `.viskod/settings.json` per `docs/architecture.md` §Storage Layout
- [ ] Loaded config is deeply frozen — no consumer can mutate it
- [ ] Hot-reload produces a new config instance and never mutates the active one
- [ ] Platform never starts without valid configuration (except when `workspaceRoot` is the only missing required field and it's provided)
- [ ] `loadConfig()` completes end-to-end under 10 ms (excluding file I/O)
- [ ] `validateConfig()` completes under 5 ms for a valid config
- [ ] `mergeConfigs()` completes under 2 ms
- [ ] All Zod schemas instantiate under 3 ms
- [ ] Environment variable mapping handles all listed `VISKOD_*` variables with correct type coercion
- [ ] Unknown `VISKOD_*` variables are silently ignored (do not pollute config)
- [ ] All unit tests pass for field-level validation (type, range, enum, required fields, edge cases)
- [ ] All integration tests pass for load/merge/migrate/reload flows
- [ ] All contract tests pass for cross-document and cross-package alignment
- [ ] No lint violations in the config package
- [ ] TypeScript strict mode compiles without errors
- [ ] `ErrorCategory.CONFIGURATION` extends SPEC-002 base categories without modifying them
- [ ] Telemetry defaults to `false`

---

## Open Implementation Decisions

| Decision ID | Description | Resolution |
|-------------|-------------|-----------|
| DEC-003 | Config file format: JSON, JSONC (JSON with comments), or YAML | Phase 1 uses JSON. JSONC support (for comments in config files) and YAML support are deferred. Record rationale and future evaluation criteria in `/decisions/DEC-003.md`. |

---

## Migration Considerations

This is a new specification with no predecessor. No migration is required for the specification itself.

For configuration schema migration (config files from older versions of the platform), the `migrateConfig()` function provides the mechanism. Migration functions are registered in a version chain. The first production schema version is `1.0`.

When `migrateConfig()` is first implemented, the migration registry will be empty (no prior versions to migrate from). Migration functions are added as the schema evolves.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Config schema evolves before any consumer is stable | Medium | Low | All consuming specs are currently Draft. Schema changes now are cheap. The migration chain is designed to handle version incrementing. |
| Zod schema too strict for real-world usage | Medium | Medium | Zod schemas can be relaxed in a new version without breaking existing configs (new version reads old config, applies defaults for new fields). Migration is backwards-compatible. |
| Deep merge behaviour surprises users (e.g., merging arrays by replacement instead of concatenation) | Medium | Low | Documented explicitly: `mergeConfigs()` performs shallow-replace for arrays — env var arrays replace file arrays entirely, not appended. This is the expected behaviour for `ignoredDirectories` and `enabledPlugins`. Complex merge strategies are deferred. |
| Config file becomes very large over time (many captures, diagnostics entries embedded) | Low | Low | Config is intentionally flat and bounded. No unbounded collections in the schema. Logs, captures, and other variable-size data are stored in separate directories under `.viskod/`, not in `settings.json`. |
| Environment variable type coercion introduces subtle bugs (e.g., locale-dependent number parsing) | Low | Medium | Type coercion uses `Number.parseInt()` with explicit radix 10 and `JSON.parse()` for booleans. Locale-dependent parsing is not used. Integration tests verify coercion behaviour. |
| `workspaceRoot` is required but no reasonable default exists | High | Medium | Documented as required. The platform cannot operate without a workspace. The CLI must detect the workspace root from the current directory if not explicitly provided, reducing the burden on the user. Workspace auto-detection is outside this specification (belongs to `cli.md`). |

---

## Implementation Sequence

1. Create package directory `packages/config/` per SPEC-001 conventions
2. Initialise `packages/config/package.json` with `@viskod/config` name, TypeScript strict mode, and dependencies on `zod` and `@viskod/shared`
3. Implement `src/types.ts` — all config interfaces (`GeneralConfig`, `BrowserConfig`, `CaptureConfig`, `ProjectConfig`, `DiagnosticsConfig`, `PluginsConfig`, `ViskodConfig`)
4. Implement `src/schemas.ts` — all Zod schemas (one per config interface, plus `ViskodConfigSchema`)
5. Implement `src/defaults.ts` — compiled default `ViskodConfig` object
6. Implement `src/env-mapping.ts` — environment variable parsing, type coercion, and mapping to config partial
7. Implement `src/merge.ts` — `mergeConfigs()` function with deep-merge logic for nested objects
8. Implement `src/validate.ts` — `validateConfig()` function wrapping `ViskodConfigSchema.parse()`, mapping `ZodError` to `ViskodError`
9. Implement `src/load.ts` — `loadConfig()` function orchestrating file read, env parsing, merge, and validation
10. Implement `src/reload.ts` — `reloadConfig()` function for hot-reload with fallback to previous config
11. Implement `src/migrate.ts` — `migrateConfig()` function with migration chain registry
12. Implement `src/export.ts` — `exportConfig()` function for pretty-printed JSON serialisation
13. Implement `src/freeze.ts` — deep-freeze utility using `DeepReadonly<T>` from `@viskod/shared`
14. Implement `src/errors.ts` — extended `ErrorCategory` with `CONFIGURATION`, error creation helpers
15. Implement `src/index.ts` — barrel re-exports (all types, schemas, and functions)
16. Write unit tests for every Zod schema (valid and invalid inputs per the table in §Testing Requirements)
17. Write integration tests for `loadConfig()`, `mergeConfigs()`, `migrateConfig()`, `reloadConfig()`, `exportConfig()`
18. Write contract tests verifying alignment with `docs/settings.md`, `docs/architecture.md`, and `@viskod/shared` constants
19. Run `tsc --noEmit --strict` and fix any errors
20. Run lint and fix any violations
21. Run all tests and verify they pass
22. Document DEC-003 (config file format) in `/decisions/DEC-003.md`
23. Update `SPEC_INDEX.md` to reflect this specification's status

---

## Definition of Done

- [ ] `packages/config/` directory exists with correct structure per SPEC-001
- [ ] `packages/config/package.json` defines `@viskod/config` with strict TypeScript config
- [ ] All config interfaces defined in `src/types.ts`
- [ ] All Zod schemas defined in `src/schemas.ts`
- [ ] Compiled defaults defined in `src/defaults.ts`
- [ ] Environment variable mapping implemented in `src/env-mapping.ts`
- [ ] Merge logic (`mergeConfigs`) implemented in `src/merge.ts`
- [ ] Validation logic (`validateConfig`) implemented in `src/validate.ts`
- [ ] Load orchestration (`loadConfig`) implemented in `src/load.ts`
- [ ] Hot-reload logic (`reloadConfig`) implemented in `src/reload.ts`
- [ ] Migration logic (`migrateConfig`) implemented in `src/migrate.ts`
- [ ] Export logic (`exportConfig`) implemented in `src/export.ts`
- [ ] Deep-freeze utility implemented in `src/freeze.ts`
- [ ] Extended error types implemented in `src/errors.ts`
- [ ] Entry point (`src/index.ts`) re-exports all public symbols
- [ ] TypeScript strict mode compiles without errors
- [ ] Zero `any` types in any export
- [ ] All unit tests pass (field-level validation: type, range, enum, required, edge cases)
- [ ] All integration tests pass (load, merge, migrate, reload, export)
- [ ] All contract tests pass (cross-document alignment)
- [ ] No lint violations
- [ ] DEC-003 documented in `/decisions/DEC-003.md`
- [ ] Specification status updated from Draft to Approved
