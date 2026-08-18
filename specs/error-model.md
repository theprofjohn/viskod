# Error Model

> **Specification ID:** SPEC-003
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Platform Architecture
> **Last Updated:** 2026-07-28

---

## Architecture Sources

* `docs/architecture.md` §Error Boundaries (lines 674-684) — each subsystem owns its own failures; failures must not cross subsystem boundaries
* `docs/architecture.md` §Error Model (lines 2025-2065) — every public error contains Code, Message, Cause, Recovery, optional Details; errors must be machine-readable; never expose internal stack traces through MCP
* `docs/error-handling.md` — full error handling specification: 9 categories, 5 severity levels, structured error lifecycle, recovery strategies, retry policy, state consistency guarantees, performance targets, failure policy, invariants
* `docs/design-principles.md` §Principle 15 (Graceful Failure) — failures must be predictable; preserve user data, maintain integrity, isolate faults, emit diagnostics, recover when possible; unexpected behaviour is more harmful than reduced functionality
* `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries (lines 122-131) — defines forbidden access per boundary: Browser Runtime must never access repository/MCP/source hints/filesystem; VCE must never access browser process/Chromium API directly; each boundary constrains what failures can originate where

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Draft | Consumes `Identifier`, `Timestamp`, and `Result<T,E>` base types; extends `ErrorCategory` enum with two additional categories; extends `ViskodError` interface with additional fields |

---

## Consumers

All runtime specifications depend on this specification for structured error creation, classification, and propagation.

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-004 (configuration) | Draft | Creates Configuration-category errors via factory functions |
| `visual-context-engine.md` | Draft | Creates VCE-xxxx errors; emits DiagnosticEvents on failure |
| `browser-runtime.md` | Draft | Creates BR-xxxx errors; enforces error boundaries to prevent propagation to VCE |
| `capture-pipeline.md` | Draft | Creates CP-xxxx errors for storage and capture failures |
| `project-scanner.md` | Draft | Creates PS-xxxx errors for scan and detection failures |
| `selection-engine.md` | Draft | Creates SE-xxxx errors for invalid selections |
| `source-hint-engine.md` | Draft | Creates SHE-xxxx errors for hint resolution failures |
| `mcp-server.md` | Draft | Creates MCP-xxxx errors for tool/resource failures |
| `studio.md` | Draft | Creates STU-xxxx errors for UI and interaction failures |
| `cli.md` | Draft | Creates CLI-xxxx errors for argument and orchestration failures |
| `event-bus.md` | Draft | Transports DiagnosticEvent payloads; never creates errors itself |
| `diagnostics.md` | Draft | Consumes DiagnosticEvent stream for health reporting |
| `logging.md` | Draft | Consumes structured errors for log emission |
| `observability.md` | Draft | Consumes error counters via health endpoint |
| `security-model.md` | Draft | Enforces no-secrets-in-errors rule on all error creation paths |
| `testing-strategy.md` | Draft | Consumes error code patterns for contract test validation |

---

## Purpose

Defines the canonical Viskod error model: the `ViskodError` type with all mandatory and optional fields, 9 error categories, 5 severity levels, subsystem-anchored error code naming conventions and numeric ranges, three error factory functions (`createError`, `isRecoverable`, `toDiagnostic`), the `DiagnosticEvent` bridge to the Event Bus, error boundary enforcement rules, error history ring buffer, subsystem error counters, and the security/privacy/performance constraints on every error instance. Every other runtime specification creates errors through this model.

---

## Scope

* The `ViskodError` canonical interface (all 10 fields)
* The `ErrorCategory` enum (9 values)
* The `ErrorSeverity` enum (5 values)
* Error code format: `{SUBSYSTEM_ABBREV}_{ERROR_NAME}` with regex validation
* Subsystem abbreviation prefixes and numeric error code ranges
* Three error factory functions: `createError`, `isRecoverable`, `toDiagnostic`
* The `DiagnosticEvent` type for Event Bus emission
* Error boundary rules: which errors propagate where
* Error history ring buffer (last 256 errors)
* Per-subsystem error counters
* Error creation and classification performance budgets
* Security: no secrets, tokens, passwords, env vars, or out-of-workspace file paths in any error field
* Privacy: no PII in metadata; correlation IDs must not encode user identity
* Error code pattern validation via Zod schema
* Contract alignment with `docs/error-handling.md`

---

## Non-Goals

* Error recovery strategy logic (retry, fallback, graceful degradation) — defined per subsystem in their respective specifications
* Transient error retry policies (max attempts, delay strategy, backoff) — defined per subsystem
* Logging format or log emission infrastructure (belongs to SPEC `logging.md`)
* Health endpoint implementation (belongs to SPEC `observability.md`)
* Diagnostic UI rendering (belongs to SPEC `studio.md` and `diagnostics.md`)
* Error wrapping or chaining beyond the `cause` string field (no nested error chains in Phase 1)
* Internationalisation of error messages (English-only in Phase 1)
* Error aggregation or anomaly detection (Phase 2+ concern)

---

## Terminology

| Term | Definition |
|------|-----------|
| Error code | A string identifier in `SUBSYSTEM_ABBREV_ERROR_NAME` format uniquely identifying one failure mode (e.g., `BR_LAUNCH_FAILED`) |
| Error category | The subsystem domain from which the error originated (e.g., Browser, Validation, Security) |
| Error severity | The operational impact of the error (Info through Fatal) |
| Recovery suggestion | An actionable, human-readable instruction for resolving the error condition; required for all Recoverable-severity errors |
| Correlation ID | A UUID v4 string linking related errors, events, and log entries across subsystems for a single operation or request |
| Subsystem abbreviation | A 2-4 character uppercase prefix identifying the originating subsystem (e.g., BR, VCE, MCP) |
| Error boundary | The isolation rule that prevents an error originating in one subsystem from crashing or corrupting an unrelated subsystem |
| Ring buffer | A fixed-size circular buffer storing the last N errors for diagnostic inspection; oldest entries are evicted on overflow |
| Error counter | A monotonic integer counter per subsystem tracking total errors emitted since process start |
| DiagnosticEvent | A structured event emitted to the Event Bus for each error, enabling downstream consumers (diagnostics, logging, observability) to process errors without direct coupling to error origin |
| Error factory | A pure function that constructs a fully populated `ViskodError` from minimal inputs, ensuring all mandatory fields are present and correctly typed |

---

## Runtime Boundary

The error model is a cross-cutting concern consumed at import time by every runtime package. It has no process of its own.

| Boundary | Responsibility |
|----------|---------------|
| Process | Consumed at import time by every other package; no independent process |
| Owns | Error type definitions, error code registry, factory functions, diagnostic event bridging, ring buffer, counters |
| Forbidden | File system access, network access, process spawning, DOM access, browser APIs, business logic, state management, logging infrastructure |

---

## Responsibilities

1. **Define the canonical `ViskodError` interface** with all 10 fields (code, category, severity, message, cause, recovery, correlationId, subsystem, timestamp, metadata)
2. **Define the canonical `ErrorCategory` enum** with all 9 categories matching `docs/error-handling.md`
3. **Define the canonical `ErrorSeverity` enum** with all 5 severity levels matching `docs/error-handling.md`
4. **Define the error code format and enforce it via regex validation** — codes must match `^[A-Z]{2,4}_[A-Z][A-Z0-9]*(_[A-Z][A-Z0-9]*)*$`
5. **Define subsystem abbreviation prefixes and numeric code ranges** for all 11 subsystems
6. **Provide factory functions** that guarantee every `ViskodError` is fully populated with valid fields
7. **Provide `isRecoverable`** to classify errors by severity for consumer recovery logic
8. **Provide `toDiagnostic`** to convert any `ViskodError` into a `DiagnosticEvent` for Event Bus emission
9. **Maintain error history ring buffer** (last 256 errors) for diagnostic inspection
10. **Maintain per-subsystem error counters** for health reporting
11. **Enforce security constraints** — no secrets, tokens, passwords, env vars, or out-of-workspace file paths in any error field
12. **Enforce privacy constraints** — no PII in metadata; correlation IDs must not encode user identity
13. **Provide Zod schemas** for runtime validation of `ViskodError`, `ErrorCategory`, `ErrorSeverity`, error codes, and `DiagnosticEvent`
14. **Document every error code** with category, severity, message template, and recovery suggestion where applicable
15. **Contract-align** with `docs/error-handling.md` — every requirement in that document must be traceable to a concrete type, function, or rule in this specification

---

## Interfaces

### Public API

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|
| `ErrorCategory` (enum, 9 members) | Classifies the domain origin of every error | Enum is imported; no runtime instantiation needed | Every `ViskodError` carries exactly one `ErrorCategory` | N/A (type-level) |
| `ErrorSeverity` (enum, 5 members) | Classifies the operational impact of every error | Enum is imported; no runtime instantiation needed | Every `ViskodError` carries exactly one `ErrorSeverity` | N/A (type-level) |
| `ViskodError` (interface) | Canonical structured error object with 10 fields | None (type-level) | Every error in the platform conforms to this shape | N/A (type-level; runtime validation via Zod) |
| `createError(code, category, severity, message, options?)` | Constructs a fully populated `ViskodError` with auto-generated correlationId, timestamp, and derived subsystem from error code prefix | `code` matches error code regex; `category` is valid enum member; `severity` is valid enum member; `message` is non-empty string | Returns a valid `ViskodError` with all 10 fields populated; correlationId is a new UUID v4; timestamp is current ISO 8601 time; subsystem is extracted from code prefix | Throws if `code` does not match regex, or if `category`/`severity` is invalid |
| `isRecoverable(error)` | Returns `true` if the error severity is `Info`, `Warning`, or `Recoverable` | `error` is a valid `ViskodError` | Boolean result; pure function with no side effects | N/A (no failure path) |
| `toDiagnostic(error)` | Converts a `ViskodError` into a `DiagnosticEvent` suitable for Event Bus emission | `error` is a valid `ViskodError` | Returns a valid `DiagnosticEvent` with `source: error.subsystem`, `severity: error.severity`, `code: error.code`, `message: error.message`, `correlationId: error.correlationId`, `timestamp: error.timestamp`, `payload: { error }` | N/A (no failure path) |
| `getErrorHistory()` | Returns a readonly snapshot of the error history ring buffer (last N errors) | Ring buffer exists (initialised at module load) | Returns `DeepReadonly<ViskodError>[]` in insertion order, most recent last; maximum length 256 | N/A (no failure path) |
| `getErrorCounters()` | Returns a readonly snapshot of per-subsystem error counters | Counters exist (initialised at module load) | Returns `Record<string, number>` mapping subsystem abbreviation to error count | N/A (no failure path) |
| `resetErrorCounters()` | Resets all per-subsystem error counters to zero | Counters exist | All counters are zero; history ring buffer is not affected | N/A (no failure path) |
| `ViskodErrorSchema` (Zod schema) | Runtime validation for `ViskodError` objects | Input is an object | Returns parsed `ViskodError` or throws `ZodError` | Validation error on invalid shape |
| `ErrorCodeSchema` (Zod schema) | Runtime validation for error code strings | Input is a string | Returns parsed string or throws `ZodError` | Validation error on non-matching code |
| `DiagnosticEventSchema` (Zod schema) | Runtime validation for `DiagnosticEvent` objects | Input is an object | Returns parsed `DiagnosticEvent` or throws `ZodError` | Validation error on invalid shape |
| `createErrorCode(subystem, errorName)` | Composes a valid error code from subsystem abbreviation and error name | `subsystem` is a valid subsystem abbreviation (2-4 uppercase chars); `errorName` matches `[A-Z][A-Z0-9]*(_[A-Z][A-Z0-9]*)*` | Returns a valid error code string; throws if inputs are invalid | Throws if `subsystem` or `errorName` do not match patterns |

### Events Published

| Event | Payload Schema | When Published |
|-------|---------------|----------------|
| `DiagnosticEvent` | `{ eventId: Identifier, eventType: "diagnostic", timestamp: Timestamp, version: Version, source: string, correlationId: Identifier, severity: ErrorSeverity, code: string, message: string, payload: { error: ViskodError } }` | Published to Event Bus whenever `createError` is called, via an internal call to `toDiagnostic`. The DiagnosticEvent is published atomically with error creation — every error becomes a diagnostic event. |

### Events Subscribed

N/A — the error model does not subscribe to events. It publishes `DiagnosticEvent` via the Event Bus but has no incoming event dependencies.

---

## Data Models

### Error Category Enum (`ErrorCategory`)

```typescript
enum ErrorCategory {
  VALIDATION = 'validation',
  CONFIGURATION = 'configuration',
  RUNTIME = 'runtime',
  NETWORK = 'network',
  STORAGE = 'storage',
  BROWSER = 'browser',
  PLUGIN = 'plugin',
  SECURITY = 'security',
  INTERNAL = 'internal',
}
```

**Mapping to `docs/error-handling.md`:** All 9 categories from `docs/error-handling.md` §Error Categories are present. SPEC-002 (`shared-types.md`) defines 7 categories and defers `Configuration` and `Plugin` to their respective specifications. This specification adds both, making it the authoritative source for the complete error category model.

**Category semantics:**

| Category | Meaning | Examples |
|----------|---------|----------|
| `VALIDATION` | Input failed schema or business rule validation | Invalid MCP tool arguments, malformed configuration values, schema mismatch |
| `CONFIGURATION` | Configuration is missing, invalid, or inconsistent | Missing required config key, conflicting settings, invalid config file syntax |
| `RUNTIME` | Unexpected failure during normal operation | Unhandled exception, assertion failure, invariant violation |
| `NETWORK` | Network communication failure | Connection refused, DNS resolution failure, timeout, TLS error |
| `STORAGE` | File system or persistence failure | Disk full, permission denied, file not found, corrupt data |
| `BROWSER` | Browser or page lifecycle failure | Launch failure, navigation timeout, DOM access denied, page crash |
| `PLUGIN` | Plugin execution or lifecycle failure | Plugin init error, capability denied, plugin timeout, sandbox violation |
| `SECURITY` | Security policy violation or threat detected | Unauthorised access attempt, invalid token, path traversal, capability escalation |
| `INTERNAL` | Internal platform error — not caused by user input or external conditions | Bug, unimplemented code path, internal state corruption |

### Error Severity Enum (`ErrorSeverity`)

```typescript
enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  RECOVERABLE = 'recoverable',
  CRITICAL = 'critical',
  FATAL = 'fatal',
}
```

**Mapping to `docs/error-handling.md`:** All 5 severity levels from `docs/error-handling.md` §Error Severity are present. SPEC-002 (`shared-types.md`) defines the same 5 levels. This specification extends their semantics with concrete behavioural rules.

**Severity semantics:**

| Severity | Operational Impact | Recovery Expectation | Consumer Behaviour |
|----------|-------------------|---------------------|-------------------|
| `INFO` | No impact on operation | N/A — informational only | Log and continue; no user-visible notification |
| `WARNING` | Degraded but functional | Operation continues with reduced capability | Log and expose via diagnostics; optional user notification |
| `RECOVERABLE` | Operation failed but can be retried or worked around | Retry, fallback, or user intervention can resolve | Consumer invokes recovery strategy; operation may succeed on retry |
| `CRITICAL` | Subsystem operation halted | Subsystem restart or reconfiguration required | Affected subsystem enters degraded state; other subsystems continue unaffected |
| `FATAL` | Platform cannot continue | Graceful shutdown required | Platform initiates shutdown sequence; user data is preserved; diagnostic emitted before exit |

### Canonical Error Interface (`ViskodError`)

```typescript
interface ViskodError {
  code: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  cause?: string;
  recovery?: string;
  correlationId: string;
  subsystem: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```

**Alignment with SPEC-002:** SPEC-002 defines a minimal `ViskodError` with 7 fields (`code`, `category`, `severity`, `message`, `correlationId`, `recoverable`, `metadata?`). This specification supersedes that with a 10-field interface:

| Field | SPEC-002 | SPEC-003 | Rationale |
|-------|----------|----------|-----------|
| `code` | `string` | `string` | Unchanged |
| `category` | `ErrorCategory` (7 values) | `ErrorCategory` (9 values) | Added `CONFIGURATION` and `PLUGIN` |
| `severity` | `ErrorSeverity` (5 values) | `ErrorSeverity` (5 values) | Unchanged |
| `message` | `string` | `string` | Unchanged |
| `cause?` | Not present | `string` | Human-readable root cause; separated from message for machine parsing |
| `recovery?` | Not present | `string` | Actionable recovery suggestion; required for all `RECOVERABLE` errors |
| `correlationId` | `Identifier` (UUID v4) | `string` | Same semantics; string type for serialisation |
| `recoverable` | `boolean` | Removed | Derived from `severity` via `isRecoverable()`; not a standalone field to prevent inconsistency |
| `subsystem` | Not present | `string` | Extracted from error code prefix (e.g., `BR_LAUNCH_FAILED` yields `"browser-runtime"`) |
| `timestamp` | Not present | `string` | ISO 8601 timestamp of error creation; enables temporal correlation |
| `metadata?` | `Record<string, unknown>` | `Record<string, unknown>` | Unchanged |

The `recoverable` boolean is replaced by the `isRecoverable()` function to prevent the class of bugs where `severity = RECOVERABLE` but `recoverable = false`. Severity is the single source of truth for recoverability.

### DiagnosticEvent

```typescript
interface DiagnosticEvent {
  eventId: string;
  eventType: 'diagnostic';
  timestamp: string;
  version: string;
  source: string;
  correlationId: string;
  severity: ErrorSeverity;
  code: string;
  message: string;
  payload: {
    error: ViskodError;
  };
}
```

`DiagnosticEvent` extends the `BaseEvent<'diagnostic', { error: ViskodError }>` pattern from SPEC-002. The `source` field is set to `error.subsystem`. The `payload` carries the full `ViskodError`, enabling downstream consumers (diagnostics, logging, observability) to access all error fields without coupling to the error creation site.

### Zod Schemas

```typescript
import { z } from 'zod';

const ErrorCategorySchema = z.nativeEnum(ErrorCategory);

const ErrorSeveritySchema = z.nativeEnum(ErrorSeverity);

const ErrorCodeSchema = z.string().regex(
  /^[A-Z]{2,4}_[A-Z][A-Z0-9]*(_[A-Z][A-Z0-9]*)*$/
);

const ViskodErrorSchema = z.object({
  code: ErrorCodeSchema,
  category: ErrorCategorySchema,
  severity: ErrorSeveritySchema,
  message: z.string().min(1).max(1024),
  cause: z.string().min(1).max(2048).optional(),
  recovery: z.string().min(1).max(2048).optional(),
  correlationId: z.string().uuid(),
  subsystem: z.string().min(1).max(64),
  timestamp: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const DiagnosticEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal('diagnostic'),
  timestamp: z.string().datetime(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  source: z.string().min(1).max(64),
  correlationId: z.string().uuid(),
  severity: ErrorSeveritySchema,
  code: ErrorCodeSchema,
  message: z.string().min(1).max(1024),
  payload: z.object({
    error: ViskodErrorSchema,
  }),
});
```

### Error Registry Entry

```typescript
interface ErrorRegistryEntry {
  code: string;
  category: ErrorCategory;
  defaultSeverity: ErrorSeverity;
  messageTemplate: string;
  recoveryTemplate?: string;
}
```

The error registry maps every known error code to its default category, severity, message template, and optional recovery template. Factory functions use the registry to populate defaults when callers provide minimal input. The registry is a compile-time constant — no runtime registration.

---

## State Model

### Error History Ring Buffer

```
┌──────────────────────────────────────────────────────────────────┐
│  Ring Buffer (capacity: 256)                                     │
│                                                                  │
│  [E0] [E1] [E2] ... [E255]                                      │
│   ↑                    ↑                                         │
│   oldest               newest (write pointer wraps on overflow)  │
│                                                                  │
│  Invariants:                                                     │
│  - Maximum 256 entries                                           │
│  - Insertion order preserved                                     │
│  - Oldest entry evicted on overflow                              │
│  - Read-only access via getErrorHistory()                        │
│  - Never cleared except at process exit                          │
└──────────────────────────────────────────────────────────────────┘
```

### Per-Subsystem Error Counters

```
┌──────────────────────────────────────────────────────┐
│  Error Counters (monotonic, per subsystem)           │
│                                                      │
│  BR      → 0       (Browser Runtime)                 │
│  VCE     → 0       (Visual Context Engine)           │
│  CP      → 0       (Capture Pipeline)                │
│  PS      → 0       (Project Scanner)                 │
│  SE      → 0       (Selection Engine)                │
│  SHE     → 0       (Source Hint Engine)              │
│  MCP     → 0       (MCP Server)                      │
│  STU     → 0       (Studio)                          │
│  CLI     → 0       (CLI)                             │
│  GEN     → 0       (General/shared)                  │
│                                                      │
│  Invariants:                                         │
│  - Values are monotonic (never decrease)              │
│  - Initialised to 0 at module load                   │
│  - Incremented atomically with error creation         │
│  - Read-only access via getErrorCounters()            │
│  - Resettable via resetErrorCounters()                │
└──────────────────────────────────────────────────────┘
```

No persistent state — ring buffer and counters are in-memory only and lost on process exit. Persistent error storage is the responsibility of `logging.md`.

---

## Command Flows

### Flow: Error Creation

```
Caller
  │
  │  createError("BR_LAUNCH_FAILED", ErrorCategory.BROWSER,
  │              ErrorSeverity.CRITICAL, "Browser process failed to launch",
  │              { cause: "Chromium executable not found at configured path",
  │                recovery: "Verify Playwright browser installation:
  │                          npx playwright install chromium" })
  │
  ▼
createError()
  │
  ├──1. Validate code against ErrorCodeSchema ──→ throws if invalid
  ├──2. Validate category against ErrorCategorySchema ──→ throws if invalid
  ├──3. Validate severity against ErrorSeveritySchema ──→ throws if invalid
  ├──4. Validate message is non-empty string ──→ throws if empty
  ├──5. Extract subsystem from code prefix (regex: ^([A-Z]{2,4})_)
  ├──6. Map subsystem abbreviation to canonical subsystem name
  │     BR → "browser-runtime", VCE → "visual-context-engine", etc.
  ├──7. Generate correlationId (UUID v4)
  ├──8. Capture current timestamp (ISO 8601)
  ├──9. Sanitise metadata (strip secrets, PII, out-of-workspace paths)
  │
  ▼
ViskodError (fully populated)
  │
  ├──10. Append to ring buffer (evict oldest if full)
  ├──11. Increment subsystem counter atomically
  │
  ▼
toDiagnostic(error)
  │
  ▼
DiagnosticEvent
  │
  └──12. Publish to Event Bus ──events──→ diagnostics, logging, observability
```

### Flow: Error Recovery Check

```
Caller
  │
  │  isRecoverable(error)
  │
  ▼
isRecoverable()
  │
  ├── Extract error.severity
  ├── Return true if severity ∈ {INFO, WARNING, RECOVERABLE}
  └── Return false if severity ∈ {CRITICAL, FATAL}
```

### Flow: Counter Inspection

```
Caller
  │
  │  getErrorCounters()
  │
  ▼
getErrorCounters()
  │
  ├── Return frozen snapshot of counter map
  │   { BR: 3, VCE: 0, CP: 1, ... }
  └── No side effects; pure read
```

---

## Event Flows

```
createError() called
  │
  ▼
ViskodError created
  │
  ▼
toDiagnostic(error) called internally
  │
  ▼
DiagnosticEvent constructed
  │
  ▼
Event Bus ──events──→ Diagnostics Engine
  │                      │
  │                      ├── Updates health state
  │                      ├── Tracks error rate per subsystem
  │                      └── Exposes via health endpoint
  │
  ├──events──→ Logging
  │                │
  │                └── Writes structured log entry
  │
  └──events──→ Studio (optional)
                     │
                     └── Updates diagnostics panel in UI
```

**Asynchronous guarantee:** The `DiagnosticEvent` is published to the Event Bus. Downstream consumers (diagnostics, logging, studio) process the event asynchronously. Error creation (`createError`) does not block on event delivery. If the Event Bus is unavailable, the error is still created, stored in the ring buffer, and counted — diagnostic event emission fails silently with a fallback log to stderr.

---

## Error Code Conventions

### Format

```
{SUBSYSTEM_ABBREV}_{ERROR_NAME}
```

**Regex:** `^[A-Z]{2,4}_[A-Z][A-Z0-9]*(_[A-Z][A-Z0-9]*)*$`

**Rules:**
- Subsystem abbreviation: 2-4 uppercase letters
- Separator: single underscore
- Error name: starts with uppercase letter, followed by uppercase letters and digits, with optional additional underscore-separated segments
- No lowercase letters, no special characters beyond underscores
- No trailing underscores

**Valid examples:** `BR_LAUNCH_FAILED`, `VCE_VALIDATION_ERROR`, `CP_STORAGE_FULL`, `PS_SCAN_TIMEOUT`, `SE_INVALID_CANDIDATE`, `MCP_TOOL_NOT_FOUND`, `CLI_INVALID_ARGS`

**Invalid examples:** `br_launch_failed` (lowercase), `BR-LAUNCH-FAILED` (hyphens), `BR_` (trailing underscore), `BROWSER_LAUNCH_FAILED` (abbreviation too long), `B_LAUNCH` (abbreviation too short)

### Subsystem Abbreviations and Code Ranges

| Abbreviation | Subsystem | Code Range | Range Start | Range End |
|-------------|-----------|------------|-------------|-----------|
| `BR` | Browser Runtime | BR-1000 to BR-1999 | 1000 | 1999 |
| `VCE` | Visual Context Engine | VCE-2000 to VCE-2999 | 2000 | 2999 |
| `CP` | Capture Pipeline | CP-3000 to CP-3999 | 3000 | 3999 |
| `PS` | Project Scanner | PS-4000 to PS-4999 | 4000 | 4999 |
| `SE` | Selection Engine | SE-5000 to SE-5999 | 5000 | 5999 |
| `SHE` | Source Hint Engine | SHE-6000 to SHE-6999 | 6000 | 6999 |
| `MCP` | MCP Server | MCP-7000 to MCP-7999 | 7000 | 7999 |
| `STU` | Studio | STU-8000 to STU-8999 | 8000 | 8999 |
| `CLI` | CLI | CLI-9000 to CLI-9999 | 9000 | 9999 |
| `GEN` | General / Shared | GEN-0000 to GEN-0999 | 0000 | 0999 |
| `DIA` | Diagnostics | DIA-10000 to DIA-10999 | 10000 | 10999 |

**Code range rules:**
- Each subsystem is allocated 1000 code numbers
- Codes within a subsystem's range are assigned sequentially at implementation time
- No two error codes may share the same number, even across subsystems (the prefix ensures uniqueness)
- Code ranges are documented in this specification; adding a new range for a new subsystem requires a specification update
- The numeric portion of the code is not part of the string code — it is a metadata property used for grouping and documentation only

### Subsystem Abbreviation to Canonical Name Mapping

```typescript
const SUBSYSTEM_NAMES: Record<string, string> = {
  'BR': 'browser-runtime',
  'VCE': 'visual-context-engine',
  'CP': 'capture-pipeline',
  'PS': 'project-scanner',
  'SE': 'selection-engine',
  'SHE': 'source-hint-engine',
  'MCP': 'mcp-server',
  'STU': 'studio',
  'CLI': 'cli',
  'GEN': 'general',
  'DIA': 'diagnostics',
};
```

---

## Concrete Error Codes

### General / Shared (GEN-0000 to GEN-0999)

| Code | Category | Severity | Message Template | Recovery |
|------|----------|----------|-----------------|----------|
| `GEN_UNEXPECTED_ERROR` | Internal | Critical | "An unexpected internal error occurred in {context}" | "Restart Viskod. If the error persists, report it with the correlation ID {correlationId}." |
| `GEN_NOT_IMPLEMENTED` | Internal | Warning | "Feature not yet implemented: {feature}" | "This feature is planned for a future release. Check the roadmap for availability." |
| `GEN_INVARIANT_VIOLATION` | Internal | Fatal | "System invariant violated: {invariant}" | "This is a bug. Restart Viskod. Report the error with the correlation ID {correlationId}." |
| `GEN_TIMEOUT` | Runtime | Recoverable | "Operation timed out after {duration}ms: {operation}" | "Increase the timeout value for this operation or check if the target system is responsive." |
| `GEN_INVALID_STATE` | Runtime | Critical | "Operation '{operation}' cannot proceed: system is in state '{state}', expected '{expected}'" | "Restart Viskod to reset internal state." |

### Browser Runtime (BR-1000 to BR-1999)

| Code | Category | Severity | Message Template | Recovery |
|------|----------|----------|-----------------|----------|
| `BR_LAUNCH_FAILED` | Browser | Critical | "Browser process failed to launch" | "Verify Playwright browser installation: `npx playwright install chromium`. Check that no other process is using the debugging port." |
| `BR_LAUNCH_TIMEOUT` | Browser | Recoverable | "Browser launch timed out after {timeout}ms" | "Increase the browser launch timeout in configuration. Check system resource availability." |
| `BR_NAVIGATION_FAILED` | Browser | Recoverable | "Failed to navigate to '{url}': {reason}" | "Verify the URL is accessible. Check network connectivity and any proxy settings." |
| `BR_NAVIGATION_TIMEOUT` | Browser | Recoverable | "Navigation to '{url}' timed out after {timeout}ms" | "Increase the navigation timeout or verify the target page is responsive." |
| `BR_PAGE_CRASHED` | Browser | Critical | "Browser page crashed: {reason}" | "The page will be recreated automatically. Persistent crashes may indicate a memory issue or incompatible page content." |
| `BR_DOM_ACCESS_DENIED` | Browser | Recoverable | "DOM access denied for element: {selector}" | "The element may be inside a cross-origin iframe or Shadow DOM with closed mode. Try selecting a different element." |
| `BR_DISCONNECTED` | Browser | Recoverable | "Browser disconnected unexpectedly" | "The browser will be reconnected automatically. Check if the browser process was terminated externally." |
| `BR_OVERLAY_INJECTION_FAILED` | Browser | Recoverable | "Failed to inject overlay into page: {reason}" | "The page may have a Content Security Policy that blocks script injection. Review CSP headers." |
| `BR_SCREENSHOT_FAILED` | Browser | Recoverable | "Screenshot capture failed: {reason}" | "Retry the capture. Check if the page has finished rendering." |
| `BR_VIEWPORT_RESIZE_FAILED` | Browser | Warning | "Failed to resize viewport to {width}x{height}: {reason}" | "The requested viewport size may be below the browser's minimum. Using the closest supported size." |
| `BR_CDP_ERROR` | Browser | Critical | "Chrome DevTools Protocol error: {method} failed with '{error}'" | "This may indicate a browser version incompatibility. Update Playwright and Chromium." |
| `BR_EXECUTION_CONTEXT_DESTROYED` | Browser | Recoverable | "JavaScript execution context was destroyed before evaluation completed" | "The page navigated or reloaded during script execution. Retry the operation." |

### Visual Context Engine (VCE-2000 to VCE-2999)

| Code | Category | Severity | Message Template | Recovery |
|------|----------|----------|-----------------|----------|
| `VCE_VALIDATION_ERROR` | Validation | Warning | "Context packet validation failed: {field} — {reason}" | "The captured data is incomplete or malformed. Recapture the selection." |
| `VCE_CONTEXT_ASSEMBLY_FAILED` | Runtime | Recoverable | "Failed to assemble context packet: {reason}" | "Retry the context assembly. If the error persists, check that all evidence sources are available." |
| `VCE_EVIDENCE_MISSING` | Validation | Warning | "Required evidence missing from context packet: {evidenceType}" | "Verify that the evidence source ({evidenceType}) is operational. The context packet will be assembled with reduced confidence." |
| `VCE_DOM_ANALYSIS_FAILED` | Runtime | Recoverable | "DOM analysis failed for element '{selector}': {reason}" | "The element may have been removed from the DOM. Reselect the target element." |
| `VCE_STYLE_COMPUTATION_FAILED` | Runtime | Warning | "Failed to compute styles for element '{selector}': {reason}" | "The element may be hidden or detached. Style information will be omitted from the context." |
| `VCE_CONFIDENCE_CALCULATION_FAILED` | Internal | Warning | "Confidence calculation failed: {reason}" | "Defaulting to 50% confidence. Retry the context assembly." |
| `VCE_HIERARCHY_BUILD_FAILED` | Runtime | Recoverable | "Failed to build DOM hierarchy for element '{selector}': {reason}" | "The DOM structure may have changed during analysis. Recapture the context." |
| `VCE_FRAMEWORK_METADATA_MISSING` | Validation | Info | "Framework metadata not available for context: {reason}" | "Framework detection may not have completed. Context will be assembled without framework annotations." |

### Capture Pipeline (CP-3000 to CP-3999)

| Code | Category | Severity | Message Template | Recovery |
|------|----------|----------|-----------------|----------|
| `CP_STORAGE_FULL` | Storage | Recoverable | "Capture storage limit reached: {usedBytes} / {limitBytes} used" | "Delete old captures or increase the storage limit in configuration." |
| `CP_STORAGE_WRITE_FAILED` | Storage | Recoverable | "Failed to write capture to disk: {reason}" | "Check disk permissions and available space. Verify the .viskod/captures/ directory is writable." |
| `CP_STORAGE_READ_FAILED` | Storage | Recoverable | "Failed to read capture '{captureId}': {reason}" | "The capture file may be corrupt or deleted. Check the .viskod/captures/ directory." |
| `CP_CAPTURE_NOT_FOUND` | Validation | Warning | "Capture not found: {captureId}" | "The capture may have been deleted or expired. Verify the capture ID." |
| `CP_RETENTION_POLICY_VIOLATION` | Configuration | Warning | "Retention policy would delete {count} captures — operation requires confirmation" | "Review and confirm the retention policy. Adjust retention settings if needed." |
| `CP_EXPORT_FAILED` | Storage | Recoverable | "Failed to export capture '{captureId}': {reason}" | "Check the export target path permissions and available space." |
| `CP_METADATA_CORRUPT` | Storage | Critical | "Capture metadata is corrupt for '{captureId}': {reason}" | "The capture metadata file may need to be rebuilt. Delete and recreate the capture." |
| `CP_CAPTURE_TOO_LARGE` | Validation | Warning | "Capture exceeds maximum size: {sizeBytes} > {maxBytes}" | "Reduce the capture scope or increase the maximum capture size in configuration." |

### Project Scanner (PS-4000 to PS-4999)

| Code | Category | Severity | Message Template | Recovery |
|------|----------|----------|-----------------|----------|
| `PS_SCAN_TIMEOUT` | Runtime | Recoverable | "Project scan timed out after {timeout}ms" | "Increase the scan timeout in configuration. Large projects may need more time." |
| `PS_FRAMEWORK_DETECTION_FAILED` | Runtime | Warning | "Failed to detect framework: {reason}" | "Specify the framework explicitly in configuration. The project will be treated as a generic project." |
| `PS_PACKAGE_MANAGER_DETECTION_FAILED` | Runtime | Warning | "Failed to detect package manager: {reason}" | "Specify the package manager explicitly in configuration." |
| `PS_REPOSITORY_NOT_FOUND` | Configuration | Recoverable | "No repository found at '{path}'" | "Verify the project path is correct and contains a supported project structure." |
| `PS_CONFIG_PARSE_ERROR` | Configuration | Recoverable | "Failed to parse project configuration: {file} — {reason}" | "Check the configuration file syntax. The file may be malformed." |
| `PS_ROUTES_EXTRACTION_FAILED` | Runtime | Warning | "Failed to extract routes: {reason}" | "Route-based hints will be unavailable. Source hints will rely on other evidence." |
| `PS_PERMISSION_DENIED` | Configuration | Recoverable | "Permission denied reading project file: {path}" | "Check file permissions for the project directory." |

### Selection Engine (SE-5000 to SE-5999)

| Code | Category | Severity | Message Template | Recovery |
|------|----------|----------|-----------------|----------|
| `SE_INVALID_CANDIDATE` | Validation | Warning | "Selection candidate rejected: {reason}" | "The selected element does not meet selection criteria. Try selecting a different element." |
| `SE_NO_CANDIDATE` | Validation | Info | "No valid selection candidate at coordinates ({x}, {y})" | "Click on a visible UI element to select it." |
| `SE_SELECTION_OUT_OF_BOUNDS` | Validation | Warning | "Selection coordinates ({x}, {y}) are outside the viewport ({width}x{height})" | "Click within the visible page area." |
| `SE_AMBIGUOUS_SELECTION` | Runtime | Warning | "Ambiguous selection: {count} elements at coordinates ({x}, {y})" | "The selection overlapped multiple elements. Click more precisely or use element navigation to disambiguate." |
| `SE_ELEMENT_HIDDEN` | Validation | Info | "Selected element is hidden (display:none or visibility:hidden)" | "Make the element visible before selecting, or select it programmatically." |
| `SE_OVERLAY_INTERFERENCE` | Runtime | Warning | "Selection intercepted by overlay element: {elementId}" | "The overlay is capturing clicks. Dismiss the overlay or select through the keyboard." |

### Source Hint Engine (SHE-6000 to SHE-6999)

| Code | Category | Severity | Message Template | Recovery |
|------|----------|----------|-----------------|----------|
| `SHE_HINT_RESOLUTION_FAILED` | Runtime | Warning | "Failed to resolve source hint: {reason}" | "Source hints will be provided with reduced confidence. Verify the project is correctly scanned." |
| `SHE_NO_ROUTE_MATCH` | Runtime | Info | "No route matched for URL '{url}'" | "The current page URL does not match any detected route. Hints will rely on DOM evidence only." |
| `SHE_COMPONENT_LOOKUP_FAILED` | Runtime | Warning | "Failed to look up component '{componentName}': {reason}" | "The component may be dynamically imported or conditionally rendered. Source hints will have reduced confidence." |
| `SHE_FRAMEWORK_ADAPTER_ERROR` | Runtime | Warning | "Framework adapter error for {framework}: {reason}" | "The framework adapter may need updating. Source hints will fall back to generic heuristics." |
| `SHE_CONFIDENCE_BELOW_THRESHOLD` | Runtime | Info | "Source hint confidence ({confidence}%) below minimum threshold ({threshold}%)" | "The hint will still be provided but should be verified manually. Confidence indicates the system is uncertain." |

### MCP Server (MCP-7000 to MCP-7999)

| Code | Category | Severity | Message Template | Recovery |
|------|----------|----------|-----------------|----------|
| `MCP_TOOL_NOT_FOUND` | Validation | Recoverable | "MCP tool not found: '{toolName}'" | "Check available tools with the `list_tools` method. Tool names are case-sensitive." |
| `MCP_RESOURCE_NOT_FOUND` | Validation | Recoverable | "MCP resource not found: '{uri}'" | "Check available resources with the `list_resources` method. Verify the resource URI is correct." |
| `MCP_INVALID_ARGUMENTS` | Validation | Recoverable | "Invalid arguments for tool '{toolName}': {validationErrors}" | "Review the tool's input schema and correct the arguments." |
| `MCP_TOOL_EXECUTION_FAILED` | Runtime | Recoverable | "Tool '{toolName}' execution failed: {reason}" | "Retry the tool call. If the error persists, check the underlying system state." |
| `MCP_PROTOCOL_ERROR` | Runtime | Critical | "MCP protocol error: {reason}" | "This may indicate a client-server version mismatch. Ensure the MCP client and server use compatible protocol versions." |
| `MCP_SESSION_EXPIRED` | Runtime | Recoverable | "MCP session expired or invalid" | "Re-establish the MCP connection. Sessions expire after the configured timeout." |
| `MCP_RATE_LIMITED` | Runtime | Recoverable | "MCP rate limit exceeded: {count} requests in {window}ms" | "Reduce request frequency or wait for the rate limit window to reset." |
| `MCP_SERVER_NOT_INITIALISED` | Runtime | Critical | "MCP server is not initialised" | "Ensure Viskod has completed startup before making MCP requests. Check startup logs for errors." |
| `MCP_CAPABILITY_NOT_AVAILABLE` | Runtime | Warning | "Requested capability '{capability}' is not available: {reason}" | "The capability may require additional configuration or an optional dependency." |

### Studio (STU-8000 to STU-8999)

| Code | Category | Severity | Message Template | Recovery |
|------|----------|----------|-----------------|----------|
| `STU_RENDER_ERROR` | Runtime | Recoverable | "Studio render error: {reason}" | "Reload the Studio window. If the error persists, restart Viskod." |
| `STU_STATE_CORRUPTION` | Internal | Critical | "Studio state corruption detected: {reason}" | "Studio state will be reset to defaults. Unsaved changes may be lost." |
| `STU_VIEWPORT_UNAVAILABLE` | Runtime | Warning | "Viewport display unavailable: {reason}" | "The browser may have disconnected. Reconnect the browser session." |
| `STU_DIAGNOSTICS_LOAD_FAILED` | Runtime | Warning | "Failed to load diagnostics: {reason}" | "The diagnostics subsystem may be unavailable. Retry loading diagnostics." |
| `STU_SETTINGS_SAVE_FAILED` | Storage | Recoverable | "Failed to save Studio settings: {reason}" | "Check disk permissions. Settings changes will be applied but not persisted." |
| `STU_SHORTCUT_CONFLICT` | Configuration | Warning | "Keyboard shortcut conflict: '{shortcut}' is assigned to both '{action1}' and '{action2}'" | "Reassign one of the conflicting shortcuts in Studio settings." |

### CLI (CLI-9000 to CLI-9999)

| Code | Category | Severity | Message Template | Recovery |
|------|----------|----------|-----------------|----------|
| `CLI_INVALID_ARGS` | Validation | Recoverable | "Invalid command-line arguments: {validationErrors}" | "Run `viskod {command} --help` for usage information." |
| `CLI_MISSING_REQUIRED_ARG` | Validation | Recoverable | "Missing required argument: '{argName}'" | "Provide the required argument. Run `viskod {command} --help` for usage." |
| `CLI_COMMAND_NOT_FOUND` | Validation | Recoverable | "Unknown command: '{command}'" | "Run `viskod --help` for a list of available commands." |
| `CLI_STARTUP_FAILED` | Runtime | Critical | "Viskod startup failed: {reason}" | "Check startup logs for details. Verify all dependencies are installed." |
| `CLI_SHUTDOWN_FAILED` | Runtime | Warning | "Viskod shutdown did not complete cleanly: {reason}" | "Some resources may not have been released. No user data was lost." |
| `CLI_PROJECT_INIT_FAILED` | Runtime | Recoverable | "Failed to initialise project: {reason}" | "Verify the project path is correct and contains a valid project." |
| `CLI_CONFIG_INVALID` | Configuration | Recoverable | "Configuration is invalid: {validationErrors}" | "Fix the configuration errors and retry. Run `viskod config validate` to check." |
| `CLI_VERSION_MISMATCH` | Configuration | Warning | "Project configuration version ({configVersion}) does not match Viskod version ({viskodVersion})" | "Update the configuration or downgrade Viskod to match the config version." |

### Diagnostics (DIA-10000 to DIA-10999)

| Code | Category | Severity | Message Template | Recovery |
|------|----------|----------|-----------------|----------|
| `DIA_HEALTH_CHECK_FAILED` | Runtime | Warning | "Health check failed for subsystem '{subsystem}': {reason}" | "The subsystem may be in a degraded state. Check subsystem-specific diagnostics." |
| `DIA_METRICS_COLLECTION_FAILED` | Internal | Warning | "Failed to collect metrics: {reason}" | "Metrics collection will be retried on the next interval." |
| `DIA_TRACING_INIT_FAILED` | Configuration | Warning | "Failed to initialise tracing: {reason}" | "Tracing will be disabled. Check tracing configuration." |

---

## Error Behaviour

### Validation Errors

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Input fails Zod schema validation | Subsystem-specific (e.g., `VCE_VALIDATION_ERROR`, `MCP_INVALID_ARGUMENTS`, `CLI_INVALID_ARGS`) | "Validation failed: {field} — {reason}" | Identify offending fields; provide corrected input matching schema |
| Required field missing from input | Subsystem-specific validation code | "Missing required field: '{field}'" | Provide the required field |
| Input type mismatch | Subsystem-specific validation code | "Expected type '{expected}' for field '{field}', got '{actual}'" | Provide input of correct type |
| Input value out of allowed range | Subsystem-specific validation code | "Value '{value}' for field '{field}' is outside allowed range [{min}, {max}]" | Provide value within range |

### Runtime Errors

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Unhandled exception in operation | Subsystem-specific runtime code | "Operation '{operation}' failed: {reason}" | Isolate affected operation; preserve system state; retry if idempotent |
| Operation timeout | `GEN_TIMEOUT` or subsystem-specific timeout code | "Operation '{operation}' timed out after {duration}ms" | Increase timeout or check target system responsiveness |
| Concurrency or race condition | `GEN_INVALID_STATE` | "Operation '{operation}' cannot proceed: system is in state '{state}'" | Retry operation; implement proper synchronisation |
| Resource exhaustion (memory, handles) | Subsystem-specific critical code | "Resource limit reached: {resource}" | Free resources; restart subsystem if needed |

### Browser Errors

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Browser process fails to start | `BR_LAUNCH_FAILED` | "Browser process failed to launch" | Verify Playwright installation; check port availability |
| Page crashes or becomes unresponsive | `BR_PAGE_CRASHED` | "Browser page crashed: {reason}" | Recreate page; isolate from other pages |
| Browser disconnects unexpectedly | `BR_DISCONNECTED` | "Browser disconnected unexpectedly" | Reconnect automatically; preserve non-browser state |
| DOM manipulation fails | `BR_DOM_ACCESS_DENIED` | "DOM access denied for element: {selector}" | Retry with alternative selector; skip inaccessible element |

**Browser error boundary:** Browser errors must never terminate unrelated operations. The VCE, Project Scanner, MCP Server, and Studio must continue functioning when the Browser Runtime experiences failures. Only browser-dependent operations (screenshots, DOM inspection, overlay) are affected.

### Security Errors

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Unauthorised access attempt | Subsystem-specific security code | "Access denied: {reason}" | Request appropriate permissions; operation rejected |
| Path traversal detected | Subsystem-specific security code | "Path traversal detected in '{input}': resolved path '{resolvedPath}' is outside workspace root '{workspaceRoot}'" | Sanitise input; operation rejected |
| Capability not granted | Subsystem-specific security code | "Required capability '{capability}' is not granted" | Grant the capability or use an alternative approach |

**Security error principle:** Security errors must fail closed — deny by default. When a security check fails, the operation must be rejected entirely. Never fall through to a less secure code path.

### Fatal Errors

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| System invariant violated | `GEN_INVARIANT_VIOLATION` | "System invariant violated: {invariant}" | Graceful shutdown; preserve user data; emit final diagnostic |
| Unrecoverable internal corruption | Fatal-level subsystem code | "Unrecoverable error: {reason}. Viskod must restart." | Initiate shutdown sequence; save unsaved data; provide restart instructions |

**Fatal error behaviour:** When a fatal error occurs, Viskod must:
1. Stop accepting new operations
2. Complete in-flight operations where safe
3. Preserve user data (save unsaved settings, flush caches)
4. Emit a final `DiagnosticEvent` with the fatal error
5. Exit with a non-zero exit code
6. Never leave the platform in an undefined state

---

## Security Requirements

* **No secrets in any error field:** The `message`, `cause`, `recovery`, and `metadata` fields must never contain passwords, API keys, tokens, cookies, environment variables, or any other secret material. Before any `ViskodError` is created, all fields must be sanitised through a `sanitiseErrorPayload` step that redacts patterns matching known secret formats.
* **No file paths outside workspace root:** The `message`, `cause`, `recovery`, and `metadata` fields must never contain absolute file paths that resolve outside the project workspace root. File paths within the workspace root may appear in errors (e.g., "Failed to read `.viskod/settings.json`").
* **No stack traces through MCP:** Internal stack traces must never be exposed in errors returned through the MCP interface. The `metadata` field on MCP-visible errors must be stripped of stack trace information. Stack traces are a development-only diagnostic.
* **Input validation before error creation:** All inputs to `createError()` must be validated before the error object is constructed. Never create an error from unvalidated external input.
* **Correlation IDs must be opaque:** Correlation IDs are UUID v4 strings. They must not encode user identity, session information, timestamps, or any other structured data.
* **Metadata must be filtered:** Before attaching metadata to a `ViskodError`, the caller must filter out any sensitive information. The `createError` function applies a default sanitisation pass that strips known secret patterns.

---

## Privacy Requirements

* **No personally identifiable information (PII):** Error messages, causes, recovery suggestions, and metadata must not contain PII. This includes names, email addresses, IP addresses, user IDs, file paths containing usernames (e.g., `/Users/john/`), and any other information that could identify an individual.
* **No repository contents in errors:** Error messages must not include snippets of source code, configuration values, or file contents from the user's repository. File paths within the workspace may be referenced but not the file contents.
* **Correlation IDs must not encode user identity:** UUID v4 provides no mechanism for embedding identity information. This is enforced by the `Identifier` type from SPEC-002.
* **No telemetry in error creation:** The `createError` function must not send any data externally. Error creation is a local-only operation.

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| `createError()` execution time | < 1 ms | `performance.now()` around a single `createError()` call with typical inputs; measured as p95 over 10,000 iterations |
| `isRecoverable()` execution time | < 0.1 ms | `performance.now()` around a single `isRecoverable()` call; p95 over 10,000 iterations |
| `toDiagnostic()` execution time | < 0.5 ms | `performance.now()` around a single `toDiagnostic()` call; p95 over 10,000 iterations |
| Error classification (category lookup) | < 2 ms | Time from receiving an exception to emitting the classified `ViskodError`; inclusive of `createError()` call |
| Ring buffer append (with eviction) | < 0.2 ms | `performance.now()` around ring buffer write including eviction of oldest entry when buffer is full |
| `getErrorHistory()` (full 256 entries) | < 1 ms | `performance.now()` around `getErrorHistory()` call on a full buffer |
| `getErrorCounters()` | < 0.1 ms | `performance.now()` around a single `getErrorCounters()` call |
| `DiagnosticEvent` emission (Event Bus publish) | < 1 ms | Time from `toDiagnostic()` return to Event Bus acknowledgment; measured as p95 |

All performance budgets are measured in isolation (not under concurrent load). Concurrent error creation scenarios are profiled in subsystem-level benchmarks.

---

## Observability

* **Every error becomes a `DiagnosticEvent`:** The `createError` function atomically creates the error, appends it to the ring buffer, increments the subsystem counter, and publishes a `DiagnosticEvent` to the Event Bus. No error is silently swallowed.
* **Error counters exposed via health endpoint:** The `getErrorCounters()` result is exposed through the platform health endpoint (`GET /health` or equivalent). Consumers can monitor error rates per subsystem.
* **Error history exposed for debugging:** The `getErrorHistory()` result is available for diagnostic inspection during development. In production, the ring buffer provides a rolling window of the most recent errors.
* **Diagnostic events logged:** The logging subsystem subscribes to `DiagnosticEvent` and writes structured log entries for every error at the appropriate log level (Info → debug, Warning → warn, Recoverable → error, Critical → error, Fatal → fatal).
* **No error goes unreported:** If the Event Bus is unavailable, `createError` falls back to writing the error to stderr as a JSON line. The error is still stored in the ring buffer and counted.

---

## Configuration

N/A — the error model has no runtime configuration. All behaviour (ring buffer size, performance budgets, error codes) is defined at the implementation level.

The ring buffer capacity (256 entries) is a compile-time constant. If future versions require a configurable buffer size, it will be added to SPEC-004 (`configuration.md`).

---

## Failure and Recovery

### What happens when `createError` itself fails

If `createError` receives invalid inputs (code that fails regex, invalid enum values, empty message), it throws a `TypeError` or `ZodError` at the call site. This is a programming error, not a runtime error — it indicates that the caller violated the `createError` precondition.

If UUID generation fails (extremely unlikely), `createError` falls back to a timestamp-based unique identifier with a `fallback-` prefix to distinguish it from standard UUIDs.

If timestamp capture fails, `createError` uses the epoch time (`1970-01-01T00:00:00.000Z`) as a sentinel value and sets `metadata.errorCreationFailure = true`.

### What happens when the Event Bus is unavailable

`DiagnosticEvent` publication is fire-and-forget. If the Event Bus rejects or drops the event:
1. The error is still created and stored in the ring buffer
2. The subsystem counter is still incremented
3. A fallback log line is written to stderr as JSON
4. The `createError` call returns successfully — the caller is not blocked

### What downstream components should do on error

1. **Catch errors at subsystem boundaries.** Every subsystem must wrap its public API calls in try/catch blocks that convert thrown exceptions into `ViskodError` instances via `createError`.
2. **Check `isRecoverable()` before attempting recovery.** Only `RECOVERABLE`, `WARNING`, and `INFO` severity errors should trigger recovery logic.
3. **Propagate errors through `Result<T>` types, not exceptions.** Use `Result<T, ViskodError>` for return values where callers are expected to handle errors.
4. **Never swallow errors silently.** If an error cannot be handled, propagate it upward. If it reaches the top-level error handler, a `GEN_UNEXPECTED_ERROR` is created and the process may terminate.
5. **Respect error boundaries.** An error originating in the Browser Runtime must not be thrown across the VCE boundary. Convert it to a VCE-domain error that describes the impact from VCE's perspective.

---

## Compatibility

### Breaking-Change Policy

A change to the error model is considered breaking if it:

1. Removes or renames an `ErrorCategory` enum member
2. Removes or renames an `ErrorSeverity` enum member
3. Removes a required field from `ViskodError`
4. Adds a required field to `ViskodError` (consumers must populate it)
5. Changes the error code regex pattern such that previously valid codes are rejected
6. Removes or renames a public API function (`createError`, `isRecoverable`, `toDiagnostic`, `getErrorHistory`, `getErrorCounters`, `resetErrorCounters`, `createErrorCode`)
7. Changes the signature of a public API function
8. Removes a subsystem abbreviation or reallocates its code range
9. Changes the `DiagnosticEvent` shape that downstream consumers depend on

### Migration Strategy

For breaking changes:

1. Increment the specification version
2. Document the change in a decision record at `/specs/decisions/`
3. Update all consumer specifications that reference changed types or functions
4. Update `docs/error-handling.md` if the change affects documented error handling behaviour
5. Update `SPEC_INDEX.md` to reflect the new version

### Deprecation Window

* Non-breaking additions (new error codes, new factory functions, new categories): available immediately
* Breaking changes to `ViskodError`, `ErrorCategory`, or `ErrorSeverity`: minimum one minor version deprecation window
* Emergency security fixes to the sanitisation logic: may bypass deprecation window with documented justification

### SPEC-002 Alignment

This specification extends `ErrorCategory` and `ViskodError` from SPEC-002. When SPEC-002 is updated:

* If SPEC-002 adds new error categories, this specification must adopt them within the same minor version
* If SPEC-002 changes `ViskodError` fields, this specification must reconcile the differences within the deprecation window
* The 7 categories in SPEC-002 remain a strict subset of the 9 categories in this specification

---

## Testing Requirements

### Unit Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| `createError` returns valid `ViskodError` with all mandatory fields populated | Happy path | All 10 fields present and correctly typed |
| `createError` returns valid `ViskodError` with optional fields (`cause`, `recovery`, `metadata`) | Happy path | Optional fields present when provided |
| `createError` auto-generates a UUID v4 `correlationId` | Happy path | `correlationId` matches UUID v4 regex |
| `createError` auto-generates an ISO 8601 `timestamp` | Happy path | `timestamp` matches ISO 8601 datetime regex |
| `createError` extracts correct `subsystem` from code prefix for all 11 subsystem abbreviations | Happy path | `BR_LAUNCH_FAILED` yields `"browser-runtime"`, `VCE_VALIDATION_ERROR` yields `"visual-context-engine"`, etc. |
| `createError` throws when code does not match regex | Invalid input | Error thrown with message describing invalid format |
| `createError` throws when code prefix does not match any known subsystem | Invalid input | Error thrown with message listing valid prefixes |
| `createError` throws when severity is not a valid `ErrorSeverity` member | Invalid input | Error thrown |
| `createError` throws when category is not a valid `ErrorCategory` member | Invalid input | Error thrown |
| `createError` throws when message is empty string | Invalid input | Error thrown |
| `createError` throws when message exceeds 1024 characters | Invalid input | Error thrown |
| `createError` sanitises secrets from message field | Security | Known secret patterns (passwords, tokens, keys) replaced with `[REDACTED]` |
| `createError` sanitises file paths outside workspace root from message field | Security | Absolute paths outside workspace root replaced with `[PATH_REDACTED]` |
| `isRecoverable` returns `true` for `INFO`, `WARNING`, `RECOVERABLE` severities | Happy path | Returns `true` for each |
| `isRecoverable` returns `false` for `CRITICAL`, `FATAL` severities | Happy path | Returns `false` for each |
| `isRecoverable` is a pure function with no side effects | Invariant | Ring buffer and counters unchanged after call |
| `toDiagnostic` returns valid `DiagnosticEvent` from a `ViskodError` | Happy path | All `DiagnosticEvent` fields populated correctly |
| `toDiagnostic` maps `error.subsystem` to `DiagnosticEvent.source` | Happy path | `source` equals `error.subsystem` |
| `toDiagnostic` includes full error in `payload.error` | Happy path | `payload.error` deeply equals input error |
| `getErrorHistory` returns empty array before any errors | Initial state | Returns `[]` |
| `getErrorHistory` returns errors in insertion order | Happy path | First error at index 0, most recent at last index |
| `getErrorHistory` returns at most 256 entries | Overflow | Buffer does not exceed capacity; oldest entry evicted |
| `getErrorCounters` returns zero for all subsystems initially | Initial state | All counters are `0` |
| `getErrorCounters` increments correctly after error creation | Happy path | Subsystem counter incremented by 1 |
| `getErrorCounters` returns frozen snapshot — mutations to return value do not affect internal state | Invariant | Internal counters unchanged after mutating returned object |
| `resetErrorCounters` resets all counters to zero | Happy path | All counters are `0` after reset |
| `resetErrorCounters` does not affect ring buffer | Invariant | Ring buffer unchanged after counter reset |
| `createErrorCode` composes valid code from BR and `LAUNCH_FAILED` | Happy path | Returns `"BR_LAUNCH_FAILED"` |
| `createErrorCode` throws for invalid subsystem abbreviation | Invalid input | Error thrown |
| `createErrorCode` throws for invalid error name | Invalid input | Error thrown |
| `ErrorCodeSchema` accepts all valid codes from §Concrete Error Codes | Happy path | Every listed code passes validation |
| `ErrorCodeSchema` rejects lowercase, hyphens, special characters, trailing underscores | Invalid input | ZodError thrown for each invalid pattern |
| `ViskodErrorSchema` parses a complete error object | Happy path | Parsed object returned |
| `ViskodErrorSchema` rejects object missing `code` | Invalid input | ZodError thrown |
| `ViskodErrorSchema` rejects object with invalid `correlationId` | Invalid input | ZodError thrown |
| `DiagnosticEventSchema` parses valid event | Happy path | Parsed object returned |
| Ring buffer append is atomic — concurrent appends do not corrupt buffer | Concurrency | All errors present after concurrent creation; no lost entries |

### Integration Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| Error creation triggers `DiagnosticEvent` publication on Event Bus | Event Bus integration | `DiagnosticEvent` received by subscriber within 10 ms of `createError` call |
| Error counters exposed at health endpoint | Observability integration | Health endpoint response includes per-subsystem error counts |
| Subsystem boundary enforces error isolation | Browser Runtime + VCE integration | Browser Runtime error does not crash VCE; VCE receives a wrapped error |
| Error ring buffer survives error creation burst | Stress test | Creating 10,000 errors in rapid succession yields ring buffer with last 256 entries and correct counter values |

### Contract Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| `ViskodError` interface matches `docs/error-handling.md` §Error Model | Cross-document contract | Every field listed in the architecture doc (`Identifier`, `Category`, `Severity`, `Message`, `Source`, `Timestamp`, `Correlation ID`, `Recovery Status`) is present in the interface |
| All 9 `ErrorCategory` values match `docs/error-handling.md` §Error Categories | Cross-document contract | `Validation`, `Configuration`, `Runtime`, `Network`, `Storage`, `Browser`, `Plugin`, `Security`, `Internal` all present |
| All 5 `ErrorSeverity` values match `docs/error-handling.md` §Error Severity | Cross-document contract | `Info`, `Warning`, `Recoverable`, `Critical`, `Fatal` all present |
| Error code regex matches documented format | Self-consistency | All concrete error codes in this spec pass validation |
| Every `RECOVERABLE` error has a `recovery` suggestion | Self-consistency | All codes with `RECOVERABLE` severity in §Concrete Error Codes have non-empty `Recovery` column |
| Subsystem abbreviation mapping matches `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names | Cross-document contract | Every subsystem abbreviation maps to a canonical subsystem name from the baseline |

### End-to-End Acceptance Criteria

| Test | Scope | Expected Result |
|------|-------|----------------|
| Browser Runtime throws `BR_LAUNCH_FAILED` → error logged, VCE continues, Studio shows diagnostic | Full stack | Browser error is contained; other subsystems operational |
| Invalid MCP tool call returns `MCP_TOOL_NOT_FOUND` with recovery suggestion | Full stack | MCP client receives structured error with actionable recovery |
| Fatal error triggers graceful shutdown with data preservation | Full stack | Settings saved; capture data intact; final diagnostic emitted; process exits non-zero |

---

## Acceptance Criteria

Before this specification can move to Approved:

- [ ] All 9 `ErrorCategory` enum members defined with concrete semantics
- [ ] All 5 `ErrorSeverity` enum members defined with concrete behavioural rules
- [ ] `ViskodError` interface defined with all 10 fields
- [ ] Error code naming convention documented with regex `^[A-Z]{2,4}_[A-Z][A-Z0-9]*(_[A-Z][A-Z0-9]*)*$`
- [ ] 11 subsystem abbreviations defined with numeric code ranges
- [ ] 11 subsystem abbreviations mapped to canonical subsystem names
- [ ] Minimum 65 concrete error codes defined across all subsystems
- [ ] All `RECOVERABLE` severity errors have recovery suggestions
- [ ] `createError(code, category, severity, message, options?)` function signature defined
- [ ] `isRecoverable(error): boolean` function signature defined
- [ ] `toDiagnostic(error): DiagnosticEvent` function signature defined
- [ ] `getErrorHistory(): DeepReadonly<ViskodError>[]` function signature defined
- [ ] `getErrorCounters(): Record<string, number>` function signature defined
- [ ] `resetErrorCounters(): void` function signature defined
- [ ] `createErrorCode(subsystem, errorName): string` function signature defined
- [ ] `ViskodErrorSchema` Zod schema defined and validated
- [ ] `ErrorCodeSchema` Zod schema defined with correct regex
- [ ] `DiagnosticEventSchema` Zod schema defined and validated
- [ ] Error history ring buffer defined with 256-entry capacity and eviction semantics
- [ ] Per-subsystem error counters defined with monotonic increment and reset semantics
- [ ] Security: `createError` sanitises secrets, tokens, passwords, and env vars from all fields
- [ ] Security: `createError` redacts file paths outside workspace root
- [ ] Security: All error factory inputs validated before error object construction
- [ ] Privacy: No PII in error messages, causes, recovery suggestions, or metadata
- [ ] Privacy: Correlation IDs are opaque UUID v4 (no embedded user identity)
- [ ] Performance: `createError` < 1 ms (p95)
- [ ] Performance: `isRecoverable` < 0.1 ms (p95)
- [ ] Performance: `toDiagnostic` < 0.5 ms (p95)
- [ ] Observability: Every error emitted as `DiagnosticEvent` via Event Bus
- [ ] Observability: Error counters exposed via health endpoint
- [ ] Contract: `ViskodError` fields align with `docs/error-handling.md` §Error Model
- [ ] Contract: Error categories align with `docs/error-handling.md` §Error Categories
- [ ] Contract: Error boundaries align with `docs/architecture.md` §Error Boundaries
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All contract tests pass
- [ ] All end-to-end acceptance criteria pass

---

## Open Implementation Decisions

None. The error model is fully defined by `docs/architecture.md` §Error Model and `docs/error-handling.md`. No decisions are deferred to implementation decision records. All error codes, categories, severities, behaviours, and constraints are specified above.

---

## Migration Considerations

This is a new specification with no predecessor. No migration is required.

When SPEC-002 (`shared-types.md`) is updated to align its `ErrorCategory` and `ViskodError` types with this specification, the following must occur:

1. SPEC-002 adds `CONFIGURATION` and `PLUGIN` to `ErrorCategory` (currently 7, needs 9)
2. SPEC-002 updates `ViskodError` to include `cause?`, `recovery?`, `subsystem`, and `timestamp`
3. SPEC-002 removes the `recoverable` boolean (replaced by `isRecoverable()`)
4. The `ErrorCategory` alignment note in SPEC-002 is updated to reference this specification as the authoritative source

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| SPEC-002 defines a conflicting `ViskodError` shape | Medium | Medium | SPEC-003 explicitly maps field differences in §Data Models. SPEC-002's alignment note already defers `Configuration` and `Plugin` categories. This specification documents the reconciliation path under §Migration Considerations. |
| Subsystem adds error codes that overflow its allocated range (1000 codes per subsystem) | Low | Low | 1000 codes per subsystem is sufficient for Phase 1-3. If exhausted, a new range can be allocated. The error code string is the primary identifier; the numeric range is for documentation only. |
| Ring buffer of 256 entries is insufficient for debugging complex failures | Low | Low | 256 entries at typical error rates (~10/second worst case) provides ~25 seconds of history. For persistent error storage, the logging subsystem provides durable retention. The ring buffer is for live debugging only. |
| Performance target of < 1 ms for `createError` is violated under concurrent load | Low | Medium | The target is measured in isolation. Concurrent benchmarks will be established during implementation. The ring buffer uses a lock-free circular buffer algorithm to minimise contention. |
| Error sanitisation misses a secret format not matching known patterns | Medium | High | The sanitisation logic uses a configurable pattern list. New patterns can be added without a specification change. This specification defines the principle (no secrets in errors); the implementation defines the pattern list. |
| `DiagnosticEvent` publication fails silently — errors are lost from observability | Low | Medium | Fallback to stderr ensures no error is completely lost. The Event Bus health is monitored; persistent Event Bus failures trigger a `GEN_UNEXPECTED_ERROR`. |

---

## Implementation Sequence

1. Define `ErrorCategory` enum with 9 members in `packages/shared/src/errors.ts` (updating SPEC-002)
2. Define `ErrorSeverity` enum with 5 members (shared with SPEC-002)
3. Define `ViskodError` interface with all 10 fields (superseding SPEC-002's version)
4. Define `DiagnosticEvent` interface
5. Implement `ErrorCodeSchema` Zod schema with error code regex
6. Implement `ViskodErrorSchema` Zod schema
7. Implement `DiagnosticEventSchema` Zod schema
8. Define subsystem abbreviation constants and name mapping
9. Implement `createErrorCode()` helper
10. Implement `createError()` factory function with:
    * Input validation (code, category, severity, message)
    * Subsystem extraction from code prefix
    * UUID v4 correlation ID generation
    * ISO 8601 timestamp capture
    * Security sanitisation pass (secrets, paths, PII)
    * Ring buffer append
    * Counter increment
    * DiagnosticEvent publication to Event Bus
11. Implement `isRecoverable()` — pure function based on severity
12. Implement `toDiagnostic()` — ViskodError to DiagnosticEvent conversion
13. Implement ring buffer (lock-free circular buffer, capacity 256)
14. Implement per-subsystem counter map with atomic increment
15. Implement `getErrorHistory()`, `getErrorCounters()`, `resetErrorCounters()`
16. Define concrete error registry with all error codes from §Concrete Error Codes
17. Write unit tests for every factory function and Zod schema
18. Write contract tests verifying alignment with `docs/error-handling.md` and `docs/architecture.md`
19. Write integration tests for Event Bus publication
20. Write end-to-end tests for error boundary isolation
21. Update SPEC-002 to reconcile `ErrorCategory` and `ViskodError` differences
22. Run lint, typecheck, and full test suite
23. Update specification status from Draft to Approved

---

## Definition of Done

- [ ] `ErrorCategory` enum defined with all 9 values
- [ ] `ErrorSeverity` enum defined with all 5 values
- [ ] `ViskodError` interface defined with all 10 fields
- [ ] `DiagnosticEvent` interface defined
- [ ] `ErrorCodeSchema` Zod schema defined and tested
- [ ] `ViskodErrorSchema` Zod schema defined and tested
- [ ] `DiagnosticEventSchema` Zod schema defined and tested
- [ ] `createError()` implemented with all 12 internal steps
- [ ] `isRecoverable()` implemented as pure function
- [ ] `toDiagnostic()` implemented
- [ ] `getErrorHistory()` implemented with ring buffer
- [ ] `getErrorCounters()` implemented
- [ ] `resetErrorCounters()` implemented
- [ ] `createErrorCode()` implemented
- [ ] Ring buffer with 256-entry capacity, lock-free, eviction on overflow
- [ ] Per-subsystem counters with atomic increment
- [ ] Security sanitisation pass in `createError` (secrets, paths, PII)
- [ ] DiagnosticEvent publication to Event Bus on every error creation
- [ ] Fallback to stderr if Event Bus unavailable
- [ ] All 65+ concrete error codes documented in error registry
- [ ] All `RECOVERABLE` errors have recovery suggestions
- [ ] All unit tests pass (40+ test cases)
- [ ] All integration tests pass
- [ ] All contract tests pass
- [ ] All end-to-end acceptance criteria pass
- [ ] `createError` < 1 ms p95 benchmark met
- [ ] `isRecoverable` < 0.1 ms p95 benchmark met
- [ ] `toDiagnostic` < 0.5 ms p95 benchmark met
- [ ] TypeScript strict mode compiles without errors
- [ ] Lint passes with no violations
- [ ] SPEC-002 alignment documented and PR opened for reconciliation
- [ ] Specification status updated from Draft to Approved
