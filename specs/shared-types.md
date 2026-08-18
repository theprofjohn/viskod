# Shared Types

> **Specification ID:** SPEC-002
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Platform Architecture
> **Last Updated:** 2026-07-28

---

## Architecture Sources

* `docs/architecture.md` §packages/shared — shared package responsibility: types, schemas, utilities, constants, errors; no business logic
* `docs/architecture.md` §Schema Strategy — every cross-package payload must use Zod; schemas are versioned; breaking changes require new version + migration
* `docs/architecture.md` §Public Interfaces — every package exposes one public API; avoid exposing implementation details
* `docs/architecture.md` §Storage Layout — defines `.viskod/` directory structure: `captures/`, `context/`, `logs/`, `cache/`, `settings.json`
* `docs/glossary.md` — canonical terminology: Platform, Viskod, Context, Event, Error, Version, Identifier
* `docs/design-principles.md` §Principle 4 (Determinism Over Probability) — platform outputs must be reproducible; identical inputs produce materially identical outputs
* `docs/design-principles.md` §Principle 9 (Explicit Over Implicit) — prefer explicit configuration, documented defaults, visible state, traceable execution
* `docs/ARCHITECTURE_BASELINE.md` §Canonical Dependency Model — shared contracts flow upward; implementation flows downward; no bi-directional dependency

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-001 (repository-layout) | Draft | Defines the package directory structure (`packages/shared/`) and naming conventions this specification populates |

---

## Consumers

All 33 remaining specifications that consume shared contracts:

| Category | Consumers | Relationship |
|----------|-----------|-------------|
| Foundation | SPEC-003 (error-model), SPEC-004 (configuration) | Import base types and Zod schemas |
| Core Runtime | `visual-context-engine.md`, `browser-runtime.md`, `event-bus.md`, `capture-pipeline.md`, `selection-engine.md`, `project-scanner.md`, `source-hint-engine.md`, `framework-adapters.md`, `diagnostics.md` | Import types, schemas, constants, and error types |
| Data & Contracts | `context-packet-schema.md`, `event-schema.md`, `resource-model.md`, `storage-schema.md`, `cache-model.md`, `settings-schema.md` | Extend base types and schemas |
| Integration | `mcp-server.md`, `plugin-system.md`, `sdk.md`, `cli.md`, `public-api.md` | Import types for public API definitions |
| Application | `studio.md`, `overlay-system.md` | Import types for UI state and event handling |
| Hardening | `security-model.md`, `permissions-enforcement.md`, `privacy-controls.md`, `logging.md`, `observability.md`, `performance-budget.md`, `testing-strategy.md`, `release.md`, `deployment.md` | Import types for config, diagnostics, and error reporting |

---

## Purpose

Defines the `@viskod/shared` package: the canonical base types, Zod schemas, error codes, event base types, and cross-package constants that form the foundation of every other Viskod package. The shared package is a stateless library containing no business logic. It exists to ensure every cross-package boundary communicates through typed, validated, versioned contracts.

---

## Scope

* Base type aliases (`Timestamp`, `Identifier`, `Version`, `URLString`, `FilePath`, `Milliseconds`, `Bytes`)
* Composite interfaces (`WithVersion`, `WithTimestamp`, `WithId`)
* Error classification model (`ErrorCategory`, `ErrorSeverity`, `ViskodError`)
* Event base type (`BaseEvent<T, P>`)
* Zod schemas for every base type and composite interface
* Cross-package constants (storage directory names, file names)
* Utility types (`DeepReadonly`, `Result`, `Maybe`)
* Single public entry point (`src/index.ts`) re-exporting all public symbols
* TypeScript strict mode enforcement
* No `any` types — `unknown`, generics, and discriminated unions only

---

## Non-Goals

* Business logic of any kind (validation, transformation, orchestration)
* File system access or I/O operations
* Network communication
* State management
* Logging, observability, or telemetry
* Package-level configuration (that belongs to SPEC-004)
* Runtime error handling strategies (that belongs to SPEC-003)
* Context Packet schema (that belongs to `context-packet-schema.md`)
* Event payload schemas beyond the base type (that belongs to `event-schema.md`)

---

## Terminology

Terms specific to this specification. Reference `docs/glossary.md` for all canonical terms.

| Term | Definition |
|------|-----------|
| Base type | A type alias that represents a fundamental concept with well-defined semantics (e.g., `Identifier` is always a UUID v4, `Timestamp` is always ISO 8601). Base types are used in every other type definition. |
| Composite interface | An interface that composes base types to express common patterns (e.g., `WithVersion` expresses that an entity carries a version number). Composite interfaces are intended for use with intersection types. |
| Utility type | A generic type alias that transforms or wraps other types without introducing new domain semantics (e.g., `DeepReadonly<T>`, `Result<T, E>`). |
| Schema | A Zod schema that provides runtime validation for a corresponding TypeScript type. Every cross-package type must have a corresponding schema. |
| Entry point | The single file (`src/index.ts`) through which all consumers import shared symbols. Internal modules must not be imported directly. |

---

## Runtime Boundary

The shared package is a stateless library. It has no runtime in the traditional sense.

| Boundary | Responsibility |
|----------|---------------|
| Process | Consumed at import time by every other package; no process of its own |
| Owns | Type definitions, Zod schemas, string constants, generic utility types |
| Forbidden | File system access, network access, process spawning, environment variable reads, DOM access, browser APIs, Node.js runtime APIs beyond pure computation, side effects of any kind |

---

## Responsibilities

1. **Define canonical base types** that every other package uses as building blocks
2. **Define Zod schemas** that validate every cross-package payload at runtime
3. **Define error classification types** that all packages use for structured error reporting
4. **Define event base type** that all event publishers extend
5. **Define storage layout constants** that reference `docs/architecture.md` §Storage Layout
6. **Define utility types** for common functional patterns (result types, readonly wrappers, optional values)
7. **Re-export all public symbols** from a single entry point (`src/index.ts`)
8. **Compile under TypeScript strict mode** without errors
9. **Contain zero `any` types** in any export
10. **Contain zero business logic** — pure types, schemas, and constants only

---

## Interfaces

### Public API

The public API is a single entry point: `src/index.ts`.

| Export | Kind | Purpose | Preconditions | Postconditions | Errors |
|--------|------|---------|---------------|----------------|--------|
| `Timestamp` | Type alias | ISO 8601 date-time string | None (type-level) | All timestamp values are ISO 8601 strings | N/A (type-level) |
| `Identifier` | Type alias | UUID v4 string | None (type-level) | All identifier values are UUID v4 strings | N/A (type-level) |
| `Version` | Type alias | Semver string (`${number}.${number}.${number}`) | None (type-level) | All version values match semver pattern | N/A (type-level) |
| `URLString` | Type alias | Validated URL string | None (type-level) | All URL values pass URL constructor | N/A (type-level) |
| `FilePath` | Type alias | Platform-specific file path string | None (type-level) | All file path values are non-empty strings | N/A (type-level) |
| `Milliseconds` | Type alias | Non-negative integer representing milliseconds | None (type-level) | All millisecond values are integers ≥ 0 | N/A (type-level) |
| `Bytes` | Type alias | Non-negative integer representing byte count | None (type-level) | All byte values are integers ≥ 0 | N/A (type-level) |
| `WithVersion` | Interface | Entity carrying a version | None (type-level) | Entity has `version: Version` | N/A (type-level) |
| `WithTimestamp` | Interface | Entity carrying creation/update timestamps | None (type-level) | Entity has `createdAt` and `updatedAt` | N/A (type-level) |
| `WithId` | Interface | Entity carrying a UUID identifier | None (type-level) | Entity has `id: Identifier` | N/A (type-level) |
| `ErrorCategory` | Enum | Classification of error origin | None (type-level) | One of 7 defined categories | N/A (type-level) |
| `ErrorSeverity` | Enum | Classification of error impact | None (type-level) | One of 5 defined levels | N/A (type-level) |
| `ViskodError` | Interface | Structured error object | None (type-level) | All required fields present | N/A (type-level) |
| `BaseEvent<T, P>` | Interface (generic) | Base type for all platform events | None (type-level) | All event fields present; payload generic | N/A (type-level) |
| `IdentifierSchema` | Zod schema | Runtime validation for `Identifier` | Input is a string | Returns parsed UUID or throws ZodError | Validation error on non-UUID input |
| `TimestampSchema` | Zod schema | Runtime validation for `Timestamp` | Input is a string | Returns parsed datetime or throws ZodError | Validation error on non-datetime input |
| `VersionSchema` | Zod schema | Runtime validation for `Version` | Input is a string | Returns parsed semver or throws ZodError | Validation error on non-semver input |
| `ErrorCategorySchema` | Zod schema | Runtime validation for `ErrorCategory` | Input is a string | Returns parsed enum value or throws ZodError | Validation error on unknown category |
| `ErrorSeveritySchema` | Zod schema | Runtime validation for `ErrorSeverity` | Input is a string | Returns parsed enum value or throws ZodError | Validation error on unknown severity |
| `ViskodErrorSchema` | Zod schema | Runtime validation for `ViskodError` | Input is an object matching the ViskodError shape | Returns parsed ViskodError or throws ZodError | Validation error on invalid shape |
| `VISKOD_STORAGE_DIR` | String constant | Hidden directory for all Viskod data | None | Value is `'.viskod'` | N/A |
| `CAPTURE_DIR` | String constant | Subdirectory for capture storage | None | Value is `'captures'` | N/A |
| `CONTEXT_DIR` | String constant | Subdirectory for context storage | None | Value is `'context'` | N/A |
| `LOG_DIR` | String constant | Subdirectory for log storage | None | Value is `'logs'` | N/A |
| `CACHE_DIR` | String constant | Subdirectory for cache storage | None | Value is `'cache'` | N/A |
| `SETTINGS_FILE` | String constant | Settings file name | None | Value is `'settings.json'` | N/A |
| `DeepReadonly<T>` | Utility type | Recursive readonly wrapper | None (type-level) | All nested properties are `readonly` | N/A (type-level) |
| `Result<T, E>` | Utility type | Discriminated union for success/error | None (type-level) | Represents either `{ ok: true; value: T }` or `{ ok: false; error: E }` | N/A (type-level) |
| `Maybe<T>` | Utility type | Optional value wrapper | None (type-level) | Represents `T \| null` | N/A (type-level) |

### Events Published

N/A — the shared package does not publish events. It provides the `BaseEvent<T, P>` type that event publishers extend.

### Events Subscribed

N/A — the shared package does not subscribe to events.

---

## Data Models

### Base Types (`src/types.ts`)

```typescript
type Timestamp = string;    // ISO 8601 date-time string
type Identifier = string;   // UUID v4 string
type Version = `${number}.${number}.${number}`;  // Semantic version
type URLString = string;    // Validated URL string
type FilePath = string;     // Platform-specific file path
type Milliseconds = number; // Non-negative integer
type Bytes = number;        // Non-negative integer

interface WithVersion {
  version: Version;
}

interface WithTimestamp {
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface WithId {
  id: Identifier;
}
```

### Error Types (`src/errors.ts`)

```typescript
enum ErrorCategory {
  VALIDATION = 'validation',
  RUNTIME = 'runtime',
  NETWORK = 'network',
  STORAGE = 'storage',
  BROWSER = 'browser',
  SECURITY = 'security',
  INTERNAL = 'internal',
}

enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  RECOVERABLE = 'recoverable',
  CRITICAL = 'critical',
  FATAL = 'fatal',
}

interface ViskodError {
  code: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  correlationId: Identifier;
  recoverable: boolean;
  metadata?: Record<string, unknown>;
}
```

**Alignment note:** The `ErrorCategory` enum in this specification contains 7 categories. `docs/error-handling.md` lists 9 categories including `Configuration` and `Plugin`. Those two categories are deferred to SPEC-004 (`configuration.md`) and `plugin-system.md` respectively. This specification defines the shared base; consuming specs may extend error behaviour but must not modify these base categories without a version increment.

### Event Base Types (`src/events.ts`)

```typescript
interface BaseEvent<T extends string, P = unknown> {
  eventId: Identifier;
  eventType: T;
  timestamp: Timestamp;
  version: Version;
  source: string;
  correlationId: Identifier;
  payload: P;
}
```

### Zod Schemas (`src/schemas.ts`)

```typescript
import { z } from 'zod';

const IdentifierSchema = z.string().uuid();

const TimestampSchema = z.string().datetime();

const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

const ErrorCategorySchema = z.nativeEnum(ErrorCategory);

const ErrorSeveritySchema = z.nativeEnum(ErrorSeverity);

const ViskodErrorSchema = z.object({
  code: z.string().min(1),
  category: ErrorCategorySchema,
  severity: ErrorSeveritySchema,
  message: z.string().min(1),
  correlationId: IdentifierSchema,
  recoverable: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
```

### Utility Types (`src/utility-types.ts`)

```typescript
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};

type Result<T, E = ViskodError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

type Maybe<T> = T | null;
```

### Constants (`src/constants.ts`)

```typescript
const VISKOD_STORAGE_DIR = '.viskod';
const CAPTURE_DIR = 'captures';
const CONTEXT_DIR = 'context';
const LOG_DIR = 'logs';
const CACHE_DIR = 'cache';
const SETTINGS_FILE = 'settings.json';
```

### Entry Point (`src/index.ts`)

```typescript
export type { Timestamp, Identifier, Version, URLString, FilePath, Milliseconds, Bytes } from './types';
export type { WithVersion, WithTimestamp, WithId } from './types';
export { ErrorCategory, ErrorSeverity } from './errors';
export type { ViskodError } from './errors';
export type { BaseEvent } from './events';
export { IdentifierSchema, TimestampSchema, VersionSchema, ErrorCategorySchema, ErrorSeveritySchema, ViskodErrorSchema } from './schemas';
export { VISKOD_STORAGE_DIR, CAPTURE_DIR, CONTEXT_DIR, LOG_DIR, CACHE_DIR, SETTINGS_FILE } from './constants';
export type { DeepReadonly, Result, Maybe } from './utility-types';
```

Internal modules (`types.ts`, `errors.ts`, `events.ts`, `schemas.ts`, `constants.ts`, `utility-types.ts`) are implementation details. Consumers must only import from `@viskod/shared` (or `src/index.ts` at the module level).

---

## State Model

N/A — the shared package is a stateless library. It defines no state, holds no state, and manages no state transitions.

---

## Command Flows

N/A — the shared package provides types and schemas consumed synchronously at import time. No command or request-response flows exist within the package itself.

---

## Event Flows

N/A — the shared package does not emit, subscribe to, or transport events. It provides the `BaseEvent<T, P>` type that event-producing subsystems extend.

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Zod schema receives non-UUID input for `IdentifierSchema` | `ZodError` (from Zod) | "Invalid uuid" (Zod-generated) | Catch and provide a valid UUID v4 string |
| Zod schema receives non-datetime input for `TimestampSchema` | `ZodError` (from Zod) | "Invalid datetime" (Zod-generated) | Catch and provide a valid ISO 8601 datetime string |
| Zod schema receives non-semver input for `VersionSchema` | `ZodError` (from Zod) | Regex mismatch message (Zod-generated) | Catch and provide a valid semver string |
| Zod schema receives unknown string for `ErrorCategorySchema` | `ZodError` (from Zod) | "Invalid enum value" (Zod-generated) | Catch and provide a valid `ErrorCategory` value |
| Zod schema receives unknown string for `ErrorSeveritySchema` | `ZodError` (from Zod) | "Invalid enum value" (Zod-generated) | Catch and provide a valid `ErrorSeverity` value |
| Zod schema receives invalid object for `ViskodErrorSchema` | `ZodError` (from Zod) | Field-level validation messages (Zod-generated) | Catch and provide a valid `ViskodError` object |

All schema validation errors are thrown as `ZodError` instances from the `zod` library. The shared package does not wrap or transform these errors — that is the responsibility of consuming code or the error model (SPEC-003).

Type guard functions (compile-time only) produce no runtime errors. TypeScript strict mode catches type mismatches at build time.

---

## Security Requirements

* No secrets, credentials, API keys, tokens, cookies, or environment variables shall appear in any type definition, schema, constant, or utility
* No file system access — the package is a pure type/schema/constant library
* No network access — no HTTP, WebSocket, or any network I/O
* No process spawning or subprocess execution
* All identifiers use UUID v4 — no personally identifiable information (PII) in type definitions
* The `Record<string, unknown>` metadata field on `ViskodError` must not be used to carry secrets; consuming code is responsible for filtering metadata before attaching it
* The `FilePath` type is a string alias — the shared package performs no path resolution or traversal. Path security is the responsibility of the consuming package

---

## Privacy Requirements

* No personally identifiable information (PII) in any type definition, constant, or schema
* No user data collection — the package is stateless
* No telemetry or analytics code
* All identifiers use UUID v4, which contains no embedded information about the source
* The `metadata` field on `ViskodError` is typed as `Record<string, unknown>` — consumers must not attach PII to error metadata
* No logging or data persistence within the shared package

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Type import resolution (all exports) | < 5 ms | Benchmark: `tsc --noEmit` on a consumer that imports all symbols |
| Zod schema instantiation (all schemas) | < 5 ms | Benchmark: `performance.now()` around `require('@viskod/shared')` schema instantiation |
| Bundle size (tree-shaken, runtime values only) | < 2 KB gzipped | Build tool output measurement |
| Type-checking overhead (full package) | < 200 ms | `tsc --noEmit --project packages/shared/tsconfig.json` |

These budgets apply to the shared package in isolation. Consumer packages add their own overhead.

---

## Observability

N/A — the shared package is a stateless library with no runtime lifecycle. It produces no logs, emits no metrics, and exposes no health endpoints. Observability for packages consuming shared types is defined in their respective specifications and in `observability.md`.

---

## Configuration

N/A — the shared package has no runtime configuration. String constants (`VISKOD_STORAGE_DIR`, etc.) are hardcoded in `src/constants.ts` and aligned with `docs/architecture.md` §Storage Layout.

Any change to these constants requires:
1. A version increment of the shared package
2. Migration notes in the changelog
3. Updates to `docs/architecture.md` §Storage Layout

Configuration of consuming packages is defined in SPEC-004 (`configuration.md`).

---

## Failure and Recovery

The shared package has no runtime failure modes beyond TypeScript compilation errors and Zod validation errors at consumer call sites.

* **Compilation failure:** If the package fails to compile under TypeScript strict mode, all consumer packages that depend on it will fail to compile. Recovery: fix the type error in the shared package and recompile.
* **Schema validation failure:** If a Zod schema rejects input at runtime, the consumer is responsible for handling the `ZodError`. Recovery: the consumer catches the error, logs it, and either rejects the invalid input or retries with corrected data. The shared package does not provide recovery logic.
* **Breaking schema change:** If a schema is changed without a version increment, previously valid consumer payloads may be rejected. Recovery: follow the compatibility policy (see §Compatibility).

---

## Compatibility

### Breaking-Change Policy

A change to the shared package is considered breaking if it:

1. Removes or renames an exported type, interface, enum, schema, constant, or utility type
2. Changes the type of an exported member (e.g., `Timestamp` from `string` to `Date`)
3. Adds a required field to an exported interface (e.g., adding `source: string` to `ViskodError` without default)
4. Removes an enum member from `ErrorCategory` or `ErrorSeverity`
5. Tightens a Zod schema such that previously valid input is rejected (e.g., changing a field from `z.string()` to `z.string().min(5)`)
6. Changes the value of an exported constant (e.g., `VISKOD_STORAGE_DIR` from `'.viskod'` to `'.viskod2'`)
7. Changes a utility type signature (e.g., `Result<T, E>` to `Result<T>`)

### Migration Strategy

Every breaking change requires:

1. A new schema version (incremented according to semver)
2. A migration guide documenting the change, rationale, and upgrade steps
3. A deprecation window (at least one minor version) where the old type/schema continues to be exported alongside the new one, marked `@deprecated` in JSDoc
4. All consumer specifications updated to reference the new version
5. Decision record in `/decisions/` documenting the rationale

### Deprecation Window

* Non-breaking additions (new types, schemas, constants): no deprecation window required, available immediately
* Breaking changes: minimum one minor version deprecation window before removal
* Emergency security fixes: may bypass the deprecation window with documented justification

---

## Testing Requirements

### Unit Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| `IdentifierSchema` parses valid UUID v4 | Happy path | Parsed string returned |
| `IdentifierSchema` rejects non-UUID input | Invalid input | `ZodError` thrown |
| `IdentifierSchema` rejects UUID v1, v3, v5 | Invalid input | `ZodError` thrown (only v4 is valid) |
| `IdentifierSchema` rejects empty string | Edge case | `ZodError` thrown |
| `TimestampSchema` parses valid ISO 8601 datetime | Happy path | Parsed string returned |
| `TimestampSchema` rejects non-datetime string | Invalid input | `ZodError` thrown |
| `TimestampSchema` rejects date-only string (no time) | Invalid input | `ZodError` thrown |
| `VersionSchema` parses valid semver (e.g., `"1.0.0"`) | Happy path | Parsed string returned |
| `VersionSchema` rejects non-semver (e.g., `"1.0"`) | Invalid input | `ZodError` thrown |
| `VersionSchema` rejects version with prerelease tag | Invalid input | `ZodError` thrown (strict semver only) |
| `ErrorCategorySchema` parses all 7 enum values | Happy path | Each enum value parsed correctly |
| `ErrorCategorySchema` rejects unknown category string | Invalid input | `ZodError` thrown |
| `ErrorSeveritySchema` parses all 5 enum values | Happy path | Each enum value parsed correctly |
| `ErrorSeveritySchema` rejects unknown severity string | Invalid input | `ZodError` thrown |
| `ViskodErrorSchema` parses valid error object | Happy path | Parsed object returned |
| `ViskodErrorSchema` parses valid error with optional metadata | Happy path | Parsed object with metadata returned |
| `ViskodErrorSchema` rejects object missing required field | Invalid input | `ZodError` thrown |
| `ViskodErrorSchema` rejects object with invalid UUID | Invalid input | `ZodError` thrown |

### Integration Tests

N/A — the shared package has no dependencies on other packages. Integration is tested implicitly through consumer packages.

### Contract Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| All exported types have corresponding Zod schemas | Contract integrity | Every exported interface has a Zod schema that validates its shape |
| All exported Zod schemas have corresponding TypeScript types | Contract integrity | Every Zod schema has a `z.infer`-derivable type that matches the exported type |
| Entry point exports match documented public API | Contract integrity | `src/index.ts` exports every symbol listed in §Interfaces > Public API |
| Constants match `docs/architecture.md` §Storage Layout | Cross-document contract | `VISKOD_STORAGE_DIR`, `CAPTURE_DIR`, `CONTEXT_DIR`, `LOG_DIR`, `CACHE_DIR`, `SETTINGS_FILE` match the architecture document |

### End-to-End Acceptance Criteria

N/A — end-to-end tests are the responsibility of consumer packages. The shared package is validated at build time (TypeScript compilation) and through unit/contract tests.

---

## Acceptance Criteria

Before this specification can move to Approved:

- [ ] All base types (`Timestamp`, `Identifier`, `Version`, `URLString`, `FilePath`, `Milliseconds`, `Bytes`) defined and exported from `src/index.ts`
- [ ] All composite interfaces (`WithVersion`, `WithTimestamp`, `WithId`) defined and exported from `src/index.ts`
- [ ] All error types (`ErrorCategory` enum, `ErrorSeverity` enum, `ViskodError` interface) defined and exported from `src/index.ts`
- [ ] `BaseEvent<T, P>` interface defined and exported from `src/index.ts`
- [ ] All Zod schemas (`IdentifierSchema`, `TimestampSchema`, `VersionSchema`, `ErrorCategorySchema`, `ErrorSeveritySchema`, `ViskodErrorSchema`) defined and exported from `src/index.ts`
- [ ] All Zod schemas pass validation for expected inputs
- [ ] All Zod schemas reject invalid inputs
- [ ] All utility types (`DeepReadonly<T>`, `Result<T, E>`, `Maybe<T>`) defined and exported from `src/index.ts`
- [ ] All constants (`VISKOD_STORAGE_DIR`, `CAPTURE_DIR`, `CONTEXT_DIR`, `LOG_DIR`, `CACHE_DIR`, `SETTINGS_FILE`) defined and exported from `src/index.ts`
- [ ] Error types align with `docs/error-handling.md` §Error Categories and §Error Severity (7 categories, 5 severity levels)
- [ ] No `any` types in any export — all generics constrained; `unknown` used for untyped data
- [ ] No business logic in any module — pure types, schemas, constants, and utility types only
- [ ] TypeScript strict mode compiles without errors (`tsc --noEmit --strict`)
- [ ] All constants match `docs/architecture.md` §Storage Layout
- [ ] Single entry point (`src/index.ts`) re-exports all public symbols; no consumer imports from internal modules
- [ ] Package directory structure matches SPEC-001 (repository-layout) conventions
- [ ] All unit tests pass
- [ ] All contract tests pass
- [ ] No lint violations in the shared package
- [ ] No stale references in the entry point (every export maps to an existing symbol)

---

## Open Implementation Decisions

| Decision ID | Description | Resolution |
|-------------|-------------|-----------|
| DEC-001 | TypeScript version floor for the shared package | Determine minimum TypeScript version required for template literal types (`${number}.${number}.${number}`), strict mode, and Zod compatibility. Record in `/decisions/DEC-001.md`. |
| DEC-002 | Serialisation format for cross-process messages | Decide between JSON and MessagePack for messages that cross process boundaries (e.g., MCP transport, Event Bus serialisation). JSON is the default until DEC-002 resolves. Record in `/decisions/DEC-002.md`. |

---

## Migration Considerations

This is a new specification with no predecessor. No migration is required.

When the shared package is first implemented, existing placeholder types in other documents (if any) must be replaced with imports from `@viskod/shared`.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Zod schema too strict for real-world data | Medium | Medium | Zod schemas are versioned. If a schema is found to be too restrictive, a new version can relax constraints. The base schemas defined here are intentionally minimal. |
| Breaking change needed before any consumer is stable | Low | High | All consuming specs are currently Draft. Breaking changes now are cheap. The deprecation window policy takes effect only after the first stable release. |
| TypeScript version incompatibility with Zod | Low | Low | Zod is the most widely used TypeScript validation library and tracks TypeScript releases closely. Template literal types are supported from TypeScript 4.1+. |
| Ambiguity between `ErrorCategory` here and `docs/error-handling.md` (which lists 9 categories) | Medium | Low | This specification explicitly defers `Configuration` and `Plugin` error categories to their respective specifications. The 7 categories defined here are the shared subset. |
| Schema version drift between shared package and consumer expectations | Medium | Medium | Contract tests verify that the entry point exports match the documented interface. Consumer specs declare their dependency version explicitly. |

---

## Implementation Sequence

1. Create package directory `packages/shared/` per SPEC-001 conventions
2. Initialise `packages/shared/package.json` with `@viskod/shared` name, TypeScript strict mode, and `zod` dependency
3. Implement `src/types.ts` — all base types and composite interfaces
4. Implement `src/errors.ts` — `ErrorCategory`, `ErrorSeverity`, `ViskodError`
5. Implement `src/events.ts` — `BaseEvent<T, P>`
6. Implement `src/schemas.ts` — all Zod schemas
7. Implement `src/constants.ts` — all string constants
8. Implement `src/utility-types.ts` — `DeepReadonly`, `Result`, `Maybe`
9. Implement `src/index.ts` — barrel re-exports
10. Write unit tests for every Zod schema
11. Write contract tests verifying entry point exports
12. Run `tsc --noEmit --strict` and fix any errors
13. Run lint and fix any violations
14. Run all tests and verify they pass
15. Document DEC-001 (TypeScript version floor) in `/decisions/DEC-001.md`
16. Document DEC-002 (serialisation format) in `/decisions/DEC-002.md`

---

## Definition of Done

- [ ] `packages/shared/` directory exists with correct structure per SPEC-001
- [ ] `packages/shared/package.json` defines `@viskod/shared` with strict TypeScript config
- [ ] `src/types.ts` implemented with all base types and composite interfaces
- [ ] `src/errors.ts` implemented with `ErrorCategory`, `ErrorSeverity`, `ViskodError`
- [ ] `src/events.ts` implemented with `BaseEvent<T, P>`
- [ ] `src/schemas.ts` implemented with all 6 Zod schemas
- [ ] `src/constants.ts` implemented with all 6 constants
- [ ] `src/utility-types.ts` implemented with `DeepReadonly`, `Result`, `Maybe`
- [ ] `src/index.ts` re-exports all public symbols
- [ ] TypeScript strict mode compiles without errors
- [ ] Zero `any` types in any export
- [ ] All Zod schemas pass unit tests (valid and invalid inputs)
- [ ] All contract tests pass
- [ ] No business logic present in any module
- [ ] Lint passes
- [ ] DEC-001 documented in `/decisions/DEC-001.md`
- [ ] DEC-002 documented in `/decisions/DEC-002.md`
- [ ] Specification status updated from Draft to Approved
