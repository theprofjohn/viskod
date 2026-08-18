# Event Schema

> **Specification ID:** SPEC-005
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Platform Architecture
> **Last Updated:** 2026-07-28

---

## Architecture Sources

* `docs/events.md` §Event Structure, §Event Categories, §Event Payloads, §Event Versioning, §Event Lifecycle, §Error Handling, §Performance Targets, §Security — full event system specification; defines the immutable, versioned event model and all design constraints
* `docs/architecture.md` §Internal Events, §Event Bus, §State Synchronisation — events as the communication mechanism between packages; Event Bus as integration boundary; BR → Event Bus → VCE flow
* `docs/ARCHITECTURE_BASELINE.md` §Asynchronous Event Flow, §Prohibited Dependencies — command dependency and event flow are distinct; no bi-directional dependency except through the Event Bus; publishers never know subscribers
* `docs/glossary.md` §Event, §Event Bus — canonical definitions: Event as "a structured notification emitted by the platform describing a meaningful occurrence"; Event Bus as "the platform's integration boundary for asynchronous, publish-subscribe communication"

A specification with no architecture sources is invalid.

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Draft | Imports `BaseEvent<T, P>`, `Identifier`, `Timestamp`, `Version`, `ViskodError`, and Zod schema utilities to construct typed event definitions |

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-007 (event-bus) | Draft | Validates and transports events defined by this specification |
| SPEC-009 (visual-context-engine) | Draft | Subscribes to Browser Lifecycle and Capture events through the Event Bus |
| All subscriber specifications | Draft | Receive typed events whose payloads are validated against the schemas defined here |

Every subsystem that publishes or subscribes to platform events depends on the canonical event schemas defined in this specification.

---

## Purpose

Defines the complete catalogue of versioned, typed event schemas for the Viskod Visual Context Platform. This specification establishes the canonical event structure, naming conventions, payload contracts, validation rules, immutability guarantees, and lifecycle semantics that every event publisher and subscriber must conform to. The event schema is the contractual foundation upon which the Event Bus (SPEC-007) operates and through which all asynchronous subsystem communication flows.

---

## Scope

* All 14 canonical platform events with typed payloads
* `BaseEvent<T, P>` extension by every event interface
* Event type naming convention (`{SUBSYSTEM_ABBREV}_EVENT:{EVENT_NAME}`)
* Discriminated union `ViskodEvent` covering all event types
* Zod validation schemas for every event payload
* Immutability rules: events are frozen after publication
* Versioning policy: breaking payload changes require major version increment
* Security constraints: no secrets, tokens, passwords, cookies, environment variables, or PII in any payload
* Event flow semantics: publishers create → Event Bus validates → Event Bus delivers → subscribers process independently
* Correlation model: `correlationId` links related events without encoding user identity

---

## Non-Goals

* Event Bus implementation (transport, delivery, subscription management) — owned by SPEC-007
* Event ordering guarantees — owned by SPEC-007 (the Event Bus specifies delivery ordering where required; this specification defines the event contracts)
* Event persistence or replay — owned by SPEC-007 and the storage model (SPEC-010)
* Business logic triggered by events — each subscriber owns its own reaction to events
* MCP resource or tool definitions that reference events — owned by SPEC-013 (mcp-server)
* Dynamic event registration or plugin-defined event types — deferred to SPEC-015 (plugin-system)
* Event metrics, tracing, or observability infrastructure — owned by SPEC-021 (observability)

---

## Terminology

Terms specific to this specification. Reference `docs/glossary.md` for all canonical terms.

| Term | Definition |
|------|-----------|
| Canonical event | One of the 14 event types defined in this specification. Every canonical event has a fixed event type string, a typed payload interface, and a Zod validation schema. No other event types exist in Phase 1. |
| Event type string | The `eventType` field value following the naming convention `{SUBSYSTEM_ABBREV}_EVENT:{EVENT_NAME}`. This string is the discriminator in the `ViskodEvent` union. |
| Payload | The `payload` field of a `BaseEvent`. Each event type defines a specific payload interface. Payloads carry only the information needed to describe what happened; they never embed imperatives, commands, or calls to action. |
| Immutability | Once an event object is created and validated, no field may be modified. Consumers receive a frozen snapshot. Attempting to mutate a delivered event is a contract violation. |
| Subsystem abbreviation | The 2–3 character prefix in an event type string identifying the emitting subsystem: `BR` (Browser Runtime), `DIAG` (Diagnostics), `PS` (Project Scanner). Each abbreviation is canonical; no other subsystem may use an existing abbreviation. |
| Correlation ID | A UUID v4 shared across all events in a causal chain. For example, `CAPTURE_STARTED`, `CAPTURE_COMPLETED`, and `CAPTURE_FAILED` for the same capture share one `correlationId`. Correlation IDs must not encode user identity, project paths, timestamps, or any PII. |
| Subscriber | Any subsystem that registers interest in one or more event types through the Event Bus. Subscribers receive validated, immutable events. Subscribers never know the publisher's identity. |

---

## Runtime Boundary

| Boundary | Responsibility |
|----------|---------------|
| Process | Consumed at import time by event publishers (to construct typed events) and by the Event Bus (to validate events against schemas). No process of its own. |
| Owns | Canonical event interfaces, Zod validation schemas, the `ViskodEvent` discriminated union, event type string constants |
| Forbidden | Event transport, event delivery, subscription management, event persistence, event replay, business logic, I/O of any kind |

---

## Responsibilities

1. **Define the `BaseEvent<T, P>` interface** (imported from SPEC-002) as the structural foundation for every canonical event
2. **Define 14 canonical event interfaces**, each extending `BaseEvent` with a specific event type string literal and typed payload
3. **Define Zod validation schemas** for every event payload, ensuring runtime validation at the Event Bus boundary
4. **Define the `ViskodEvent` discriminated union** covering all canonical event types
5. **Enforce the event type naming convention** (`{SUBSYSTEM_ABBREV}_EVENT:{EVENT_NAME}`)
6. **Define event category groupings** (Browser Lifecycle, Viewport and Selection, Capture, Diagnostics, Project) for discoverability
7. **Define the event lifecycle** from creation through validation, publication, delivery, and processing
8. **Define error codes** for event validation failures (`EVENT_VALIDATION_FAILED`, `EVENT_VERSION_MISMATCH`)
9. **Define the immutability contract** — events are frozen after publication; consumers receive read-only snapshots
10. **Define security and privacy constraints** on event payloads — no secrets, no PII, no encodable identity in correlation IDs
11. **Define versioning policy** — breaking payload changes require version increment; non-breaking additions do not
12. **Assert zero business logic** — this specification defines data contracts, not behaviour

---

## Interfaces

### Public API

The public API is the set of exported TypeScript interfaces, Zod schemas, and event type string constants consumed by event publishers and the Event Bus.

| Export | Kind | Purpose | Preconditions | Postconditions | Errors |
|--------|------|---------|---------------|----------------|--------|
| `BrowserStartedEvent` | Interface (extends `BaseEvent`) | Published when a browser context is successfully launched | `eventType` is `"BR_EVENT:BROWSER_STARTED"` | Typed event with `browserContextId` in payload | N/A (type-level) |
| `BrowserStoppedEvent` | Interface (extends `BaseEvent`) | Published when a browser context is cleanly shut down | `eventType` is `"BR_EVENT:BROWSER_STOPPED"` | Typed event with `browserContextId` and `exitCode` in payload | N/A (type-level) |
| `PageLoadedEvent` | Interface (extends `BaseEvent`) | Published when a page finishes loading in a browser context | `eventType` is `"BR_EVENT:PAGE_LOADED"` | Typed event with `browserContextId`, `url`, `loadTimeMs` in payload | N/A (type-level) |
| `NavigationCompletedEvent` | Interface (extends `BaseEvent`) | Published when browser navigation completes | `eventType` is `"BR_EVENT:NAVIGATION_COMPLETED"` | Typed event with `browserContextId`, `fromUrl`, `toUrl` in payload | N/A (type-level) |
| `BrowserDisconnectedEvent` | Interface (extends `BaseEvent`) | Published when the browser disconnects unexpectedly | `eventType` is `"BR_EVENT:BROWSER_DISCONNECTED"` | Typed event with `browserContextId` and `reason` in payload | N/A (type-level) |
| `ViewportChangedEvent` | Interface (extends `BaseEvent`) | Published when the viewport dimensions change | `eventType` is `"BR_EVENT:VIEWPORT_CHANGED"` | Typed event with `browserContextId`, `width`, `height`, `deviceScaleFactor` in payload | N/A (type-level) |
| `SelectionChangedEvent` | Interface (extends `BaseEvent`) | Published when the user selects a different UI element | `eventType` is `"BR_EVENT:SELECTION_CHANGED"` | Typed event with `browserContextId`, `elementSelector`, `boundingBox` in payload | N/A (type-level) |
| `CaptureStartedEvent` | Interface (extends `BaseEvent`) | Published when a capture operation begins | `eventType` is `"BR_EVENT:CAPTURE_STARTED"` | Typed event with `captureId`, `captureType`, `browserContextId` in payload | N/A (type-level) |
| `CaptureCompletedEvent` | Interface (extends `BaseEvent`) | Published when a capture operation completes successfully | `eventType` is `"BR_EVENT:CAPTURE_COMPLETED"` | Typed event with `captureId`, `screenshotPath`, `durationMs` in payload | N/A (type-level) |
| `CaptureFailedEvent` | Interface (extends `BaseEvent`) | Published when a capture operation fails | `eventType` is `"BR_EVENT:CAPTURE_FAILED"` | Typed event with `captureId` and `error: ViskodError` in payload | N/A (type-level) |
| `DiagnosticsUpdatedEvent` | Interface (extends `BaseEvent`) | Published when a subsystem's health status changes | `eventType` is `"DIAG_EVENT:DIAGNOSTICS_UPDATED"` | Typed event with `subsystem`, `status`, `errors` in payload | N/A (type-level) |
| `ConsoleErrorEvent` | Interface (extends `BaseEvent`) | Published when a console error is detected in a browser page | `eventType` is `"DIAG_EVENT:CONSOLE_ERROR"` | Typed event with `browserContextId`, `message`, `source`, `line` in payload | N/A (type-level) |
| `ProjectLoadedEvent` | Interface (extends `BaseEvent`) | Published when a project is scanned and identified | `eventType` is `"PS_EVENT:PROJECT_LOADED"` | Typed event with `projectRoot`, `framework`, `packageManager` in payload | N/A (type-level) |
| `ScanCompletedEvent` | Interface (extends `BaseEvent`) | Published when a project scan completes | `eventType` is `"PS_EVENT:SCAN_COMPLETED"` | Typed event with `projectRoot`, `durationMs`, `filesScanned` in payload | N/A (type-level) |
| `ViskodEvent` | Discriminated union type | Union of all 14 canonical event interfaces | Every member extends `BaseEvent` | Exhaustive coverage of all event types | N/A (type-level) |
| `BrowserStartedSchema` | Zod schema | Runtime validation for `BrowserStartedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `BrowserStoppedSchema` | Zod schema | Runtime validation for `BrowserStoppedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `PageLoadedSchema` | Zod schema | Runtime validation for `PageLoadedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `NavigationCompletedSchema` | Zod schema | Runtime validation for `NavigationCompletedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `BrowserDisconnectedSchema` | Zod schema | Runtime validation for `BrowserDisconnectedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `ViewportChangedSchema` | Zod schema | Runtime validation for `ViewportChangedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `SelectionChangedSchema` | Zod schema | Runtime validation for `SelectionChangedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `CaptureStartedSchema` | Zod schema | Runtime validation for `CaptureStartedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `CaptureCompletedSchema` | Zod schema | Runtime validation for `CaptureCompletedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `CaptureFailedSchema` | Zod schema | Runtime validation for `CaptureFailedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `DiagnosticsUpdatedSchema` | Zod schema | Runtime validation for `DiagnosticsUpdatedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `ConsoleErrorSchema` | Zod schema | Runtime validation for `ConsoleErrorEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `ProjectLoadedSchema` | Zod schema | Runtime validation for `ProjectLoadedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `ScanCompletedSchema` | Zod schema | Runtime validation for `ScanCompletedEvent` payload | Input is an object matching the payload shape | Returns parsed payload or throws `ZodError` | `EVENT_VALIDATION_FAILED` on invalid payload |
| `ViskodEventSchema` | Zod schema (discriminated union) | Runtime validation that discriminates on `eventType` and validates the corresponding payload | Input is an object with an `eventType` field | Returns parsed `ViskodEvent` or throws `ZodError` | `EVENT_VALIDATION_FAILED` on unknown event type or invalid payload |
| `BROWSER_STARTED` | String constant | Event type string | Value is `"BR_EVENT:BROWSER_STARTED"` | Immutable | N/A |
| `BROWSER_STOPPED` | String constant | Event type string | Value is `"BR_EVENT:BROWSER_STOPPED"` | Immutable | N/A |
| `PAGE_LOADED` | String constant | Event type string | Value is `"BR_EVENT:PAGE_LOADED"` | Immutable | N/A |
| `NAVIGATION_COMPLETED` | String constant | Event type string | Value is `"BR_EVENT:NAVIGATION_COMPLETED"` | Immutable | N/A |
| `BROWSER_DISCONNECTED` | String constant | Event type string | Value is `"BR_EVENT:BROWSER_DISCONNECTED"` | Immutable | N/A |
| `VIEWPORT_CHANGED` | String constant | Event type string | Value is `"BR_EVENT:VIEWPORT_CHANGED"` | Immutable | N/A |
| `SELECTION_CHANGED` | String constant | Event type string | Value is `"BR_EVENT:SELECTION_CHANGED"` | Immutable | N/A |
| `CAPTURE_STARTED` | String constant | Event type string | Value is `"BR_EVENT:CAPTURE_STARTED"` | Immutable | N/A |
| `CAPTURE_COMPLETED` | String constant | Event type string | Value is `"BR_EVENT:CAPTURE_COMPLETED"` | Immutable | N/A |
| `CAPTURE_FAILED` | String constant | Event type string | Value is `"BR_EVENT:CAPTURE_FAILED"` | Immutable | N/A |
| `DIAGNOSTICS_UPDATED` | String constant | Event type string | Value is `"DIAG_EVENT:DIAGNOSTICS_UPDATED"` | Immutable | N/A |
| `CONSOLE_ERROR` | String constant | Event type string | Value is `"DIAG_EVENT:CONSOLE_ERROR"` | Immutable | N/A |
| `PROJECT_LOADED` | String constant | Event type string | Value is `"PS_EVENT:PROJECT_LOADED"` | Immutable | N/A |
| `SCAN_COMPLETED` | String constant | Event type string | Value is `"PS_EVENT:SCAN_COMPLETED"` | Immutable | N/A |

### Events Published

N/A — this specification defines event schemas; it does not publish events at runtime. Publishing is the responsibility of the respective subsystems (Browser Runtime, Diagnostics, Project Scanner).

### Events Subscribed

N/A — this specification defines event schemas; it does not subscribe to events at runtime. Subscribing is the responsibility of consuming subsystems through the Event Bus (SPEC-007).

---

## Data Models

### Base Event Interface (imported from SPEC-002)

```typescript
interface BaseEvent<T extends string, P = unknown> {
  eventId: string;         // UUID v4
  eventType: T;            // Discriminated string literal
  timestamp: string;       // ISO 8601
  version: string;         // Semver
  source: string;          // Subsystem identifier (e.g., "browser-runtime", "diagnostics", "project-scanner")
  correlationId: string;   // UUID v4, shared across related events in a causal chain
  payload: P;              // Typed payload specific to the event type
}
```

### Event Type Naming Convention

```
{SUBSYSTEM_ABBREV}_EVENT:{EVENT_NAME}
```

| Abbreviation | Subsystem | Source Field Value |
|-------------|-----------|-------------------|
| `BR` | Browser Runtime | `"browser-runtime"` |
| `DIAG` | Diagnostics | `"diagnostics"` |
| `PS` | Project Scanner | `"project-scanner"` |

The delimiter between abbreviation and category is `_EVENT:`. Event names use `SCREAMING_SNAKE_CASE`.

### Canonical Subsystem Abbreviations

These abbreviations are canonical and must not be reused by any other subsystem:

| Abbreviation | Subsystem | Ownership |
|-------------|-----------|-----------|
| `BR` | Browser Runtime | Browser lifecycle, viewport, selection, capture events |
| `DIAG` | Diagnostics | Health status, console error events |
| `PS` | Project Scanner | Project loading and scan completion events |

Future subsystems (VCE, Capture Pipeline, Plugin System, MCP Server) will receive their own abbreviations when they become event publishers.

---

## Event Categories and Schemas

### Category 1: Browser Lifecycle Events

Emitting subsystem: Browser Runtime

#### BR_EVENT:BROWSER_STARTED

Published when a browser context is successfully launched and ready for navigation.

```typescript
interface BrowserStartedEvent extends BaseEvent<"BR_EVENT:BROWSER_STARTED", BrowserStartedPayload> {}

interface BrowserStartedPayload {
  browserContextId: string;  // UUID v4 identifying the browser context
}
```

#### BR_EVENT:BROWSER_STOPPED

Published when a browser context is cleanly shut down by the platform.

```typescript
interface BrowserStoppedEvent extends BaseEvent<"BR_EVENT:BROWSER_STOPPED", BrowserStoppedPayload> {}

interface BrowserStoppedPayload {
  browserContextId: string;  // UUID v4 identifying the browser context
  exitCode: number;           // Process exit code (0 = clean shutdown)
}
```

#### BR_EVENT:PAGE_LOADED

Published when a page finishes loading (the `load` event fires) in a browser context.

```typescript
interface PageLoadedEvent extends BaseEvent<"BR_EVENT:PAGE_LOADED", PageLoadedPayload> {}

interface PageLoadedPayload {
  browserContextId: string;  // UUID v4 identifying the browser context
  url: string;               // The URL that finished loading
  loadTimeMs: number;        // Time from navigation start to load event in milliseconds
}
```

#### BR_EVENT:NAVIGATION_COMPLETED

Published when browser navigation completes (URL changes), regardless of page load status.

```typescript
interface NavigationCompletedEvent extends BaseEvent<"BR_EVENT:NAVIGATION_COMPLETED", NavigationCompletedPayload> {}

interface NavigationCompletedPayload {
  browserContextId: string;  // UUID v4 identifying the browser context
  fromUrl: string;           // URL before navigation
  toUrl: string;             // URL after navigation
}
```

#### BR_EVENT:BROWSER_DISCONNECTED

Published when the browser disconnects unexpectedly (crash, external termination, network loss).

```typescript
interface BrowserDisconnectedEvent extends BaseEvent<"BR_EVENT:BROWSER_DISCONNECTED", BrowserDisconnectedPayload> {}

interface BrowserDisconnectedPayload {
  browserContextId: string;  // UUID v4 identifying the browser context
  reason: string;            // Human-readable reason for disconnection
}
```

---

### Category 2: Viewport and Selection Events

Emitting subsystem: Browser Runtime

#### BR_EVENT:VIEWPORT_CHANGED

Published when the viewport dimensions or device scale factor change.

```typescript
interface ViewportChangedEvent extends BaseEvent<"BR_EVENT:VIEWPORT_CHANGED", ViewportChangedPayload> {}

interface ViewportChangedPayload {
  browserContextId: string;  // UUID v4 identifying the browser context
  width: number;             // Viewport width in CSS pixels
  height: number;            // Viewport height in CSS pixels
  deviceScaleFactor: number; // Device pixel ratio (e.g., 1.0, 2.0)
}
```

#### BR_EVENT:SELECTION_CHANGED

Published when the user selects a different UI element in the inspected page.

```typescript
interface SelectionChangedEvent extends BaseEvent<"BR_EVENT:SELECTION_CHANGED", SelectionChangedPayload> {}

interface SelectionChangedPayload {
  browserContextId: string;  // UUID v4 identifying the browser context
  elementSelector: string;   // CSS selector path to the selected element
  boundingBox: {             // Element bounding box in CSS pixels
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

---

### Category 3: Capture Events

Emitting subsystem: Browser Runtime

These three events form a correlated lifecycle for every capture operation. All three share the same `correlationId`.

#### BR_EVENT:CAPTURE_STARTED

Published when a capture operation begins.

```typescript
interface CaptureStartedEvent extends BaseEvent<"BR_EVENT:CAPTURE_STARTED", CaptureStartedPayload> {}

interface CaptureStartedPayload {
  captureId: string;          // UUID v4 identifying the capture
  captureType: "viewport" | "selection" | "full-page";  // Type of capture
  browserContextId: string;   // UUID v4 identifying the browser context
}
```

#### BR_EVENT:CAPTURE_COMPLETED

Published when a capture operation completes successfully.

```typescript
interface CaptureCompletedEvent extends BaseEvent<"BR_EVENT:CAPTURE_COMPLETED", CaptureCompletedPayload> {}

interface CaptureCompletedPayload {
  captureId: string;        // UUID v4 matching the CAPTURE_STARTED event
  screenshotPath: string;   // Platform-specific file path to the saved screenshot
  durationMs: number;       // Time from capture start to completion in milliseconds
}
```

#### BR_EVENT:CAPTURE_FAILED

Published when a capture operation fails.

```typescript
interface CaptureFailedEvent extends BaseEvent<"BR_EVENT:CAPTURE_FAILED", CaptureFailedPayload> {}

interface CaptureFailedPayload {
  captureId: string;   // UUID v4 matching the CAPTURE_STARTED event
  error: ViskodError;  // Structured error from SPEC-002
}
```

---

### Category 4: Diagnostics Events

Emitting subsystem: Diagnostics

#### DIAG_EVENT:DIAGNOSTICS_UPDATED

Published when a subsystem's health status changes.

```typescript
interface DiagnosticsUpdatedEvent extends BaseEvent<"DIAG_EVENT:DIAGNOSTICS_UPDATED", DiagnosticsUpdatedPayload> {}

interface DiagnosticsUpdatedPayload {
  subsystem: string;                                // Name of the reporting subsystem
  status: "healthy" | "degraded" | "unavailable" | "recovering";  // Health status
  errors: ViskodError[];                             // Active errors for this subsystem (empty if healthy)
}
```

#### DIAG_EVENT:CONSOLE_ERROR

Published when a console error is detected in a browser page.

```typescript
interface ConsoleErrorEvent extends BaseEvent<"DIAG_EVENT:CONSOLE_ERROR", ConsoleErrorPayload> {}

interface ConsoleErrorPayload {
  browserContextId: string;  // UUID v4 identifying the browser context
  message: string;           // The console error message text
  source: string;            // Source file or URL where the error occurred
  line: number;              // Line number where the error occurred
}
```

---

### Category 5: Project Events

Emitting subsystem: Project Scanner

#### PS_EVENT:PROJECT_LOADED

Published when a project is scanned and successfully identified.

```typescript
interface ProjectLoadedEvent extends BaseEvent<"PS_EVENT:PROJECT_LOADED", ProjectLoadedPayload> {}

interface ProjectLoadedPayload {
  projectRoot: string;     // Absolute path to the project root directory
  framework: string;       // Detected framework (e.g., "react", "vue", "next.js", "unknown")
  packageManager: string;  // Detected package manager (e.g., "pnpm", "npm", "yarn")
}
```

#### PS_EVENT:SCAN_COMPLETED

Published when a project scan completes.

```typescript
interface ScanCompletedEvent extends BaseEvent<"PS_EVENT:SCAN_COMPLETED", ScanCompletedPayload> {}

interface ScanCompletedPayload {
  projectRoot: string;   // Absolute path to the project root directory
  durationMs: number;    // Time from scan start to completion in milliseconds
  filesScanned: number;  // Total number of files examined during the scan
}
```

---

### Discriminated Union

```typescript
type ViskodEvent =
  | BrowserStartedEvent
  | BrowserStoppedEvent
  | PageLoadedEvent
  | NavigationCompletedEvent
  | BrowserDisconnectedEvent
  | ViewportChangedEvent
  | SelectionChangedEvent
  | CaptureStartedEvent
  | CaptureCompletedEvent
  | CaptureFailedEvent
  | DiagnosticsUpdatedEvent
  | ConsoleErrorEvent
  | ProjectLoadedEvent
  | ScanCompletedEvent;
```

The discriminant is the `eventType` field, which is a string literal unique to each event interface. TypeScript narrows the union based on the discriminant.

---

### Zod Validation Schemas

Every payload interface has a corresponding Zod schema. The Event Bus uses these schemas to validate events at runtime before delivery.

```typescript
import { z } from "zod";

const browserStartedPayloadSchema = z.object({
  browserContextId: z.string().uuid(),
});

const browserStoppedPayloadSchema = z.object({
  browserContextId: z.string().uuid(),
  exitCode: z.number().int(),
});

const pageLoadedPayloadSchema = z.object({
  browserContextId: z.string().uuid(),
  url: z.string().min(1),
  loadTimeMs: z.number().nonnegative(),
});

const navigationCompletedPayloadSchema = z.object({
  browserContextId: z.string().uuid(),
  fromUrl: z.string().min(1),
  toUrl: z.string().min(1),
});

const browserDisconnectedPayloadSchema = z.object({
  browserContextId: z.string().uuid(),
  reason: z.string().min(1),
});

const viewportChangedPayloadSchema = z.object({
  browserContextId: z.string().uuid(),
  width: z.number().positive(),
  height: z.number().positive(),
  deviceScaleFactor: z.number().positive(),
});

const selectionChangedPayloadSchema = z.object({
  browserContextId: z.string().uuid(),
  elementSelector: z.string().min(1),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
});

const captureStartedPayloadSchema = z.object({
  captureId: z.string().uuid(),
  captureType: z.enum(["viewport", "selection", "full-page"]),
  browserContextId: z.string().uuid(),
});

const captureCompletedPayloadSchema = z.object({
  captureId: z.string().uuid(),
  screenshotPath: z.string().min(1),
  durationMs: z.number().nonnegative(),
});

const captureFailedPayloadSchema = z.object({
  captureId: z.string().uuid(),
  error: ViskodErrorSchema,
});

const diagnosticsUpdatedPayloadSchema = z.object({
  subsystem: z.string().min(1),
  status: z.enum(["healthy", "degraded", "unavailable", "recovering"]),
  errors: z.array(ViskodErrorSchema),
});

const consoleErrorPayloadSchema = z.object({
  browserContextId: z.string().uuid(),
  message: z.string().min(1),
  source: z.string().min(1),
  line: z.number().int().nonnegative(),
});

const projectLoadedPayloadSchema = z.object({
  projectRoot: z.string().min(1),
  framework: z.string().min(1),
  packageManager: z.string().min(1),
});

const scanCompletedPayloadSchema = z.object({
  projectRoot: z.string().min(1),
  durationMs: z.number().nonnegative(),
  filesScanned: z.number().int().nonnegative(),
});
```

The `ViskodErrorSchema` is imported from SPEC-002 (`@viskod/shared`).

The discriminated union schema validates the full event object:

```typescript
const viskodEventSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("BR_EVENT:BROWSER_STARTED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("browser-runtime"),
    correlationId: z.string().uuid(),
    payload: browserStartedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("BR_EVENT:BROWSER_STOPPED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("browser-runtime"),
    correlationId: z.string().uuid(),
    payload: browserStoppedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("BR_EVENT:PAGE_LOADED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("browser-runtime"),
    correlationId: z.string().uuid(),
    payload: pageLoadedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("BR_EVENT:NAVIGATION_COMPLETED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("browser-runtime"),
    correlationId: z.string().uuid(),
    payload: navigationCompletedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("BR_EVENT:BROWSER_DISCONNECTED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("browser-runtime"),
    correlationId: z.string().uuid(),
    payload: browserDisconnectedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("BR_EVENT:VIEWPORT_CHANGED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("browser-runtime"),
    correlationId: z.string().uuid(),
    payload: viewportChangedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("BR_EVENT:SELECTION_CHANGED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("browser-runtime"),
    correlationId: z.string().uuid(),
    payload: selectionChangedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("BR_EVENT:CAPTURE_STARTED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("browser-runtime"),
    correlationId: z.string().uuid(),
    payload: captureStartedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("BR_EVENT:CAPTURE_COMPLETED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("browser-runtime"),
    correlationId: z.string().uuid(),
    payload: captureCompletedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("BR_EVENT:CAPTURE_FAILED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("browser-runtime"),
    correlationId: z.string().uuid(),
    payload: captureFailedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("DIAG_EVENT:DIAGNOSTICS_UPDATED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("diagnostics"),
    correlationId: z.string().uuid(),
    payload: diagnosticsUpdatedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("DIAG_EVENT:CONSOLE_ERROR"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("diagnostics"),
    correlationId: z.string().uuid(),
    payload: consoleErrorPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("PS_EVENT:PROJECT_LOADED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("project-scanner"),
    correlationId: z.string().uuid(),
    payload: projectLoadedPayloadSchema,
  }),
  z.object({
    eventId: z.string().uuid(),
    eventType: z.literal("PS_EVENT:SCAN_COMPLETED"),
    timestamp: z.string().datetime(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source: z.literal("project-scanner"),
    correlationId: z.string().uuid(),
    payload: scanCompletedPayloadSchema,
  }),
]);
```

---

## State Model

Events themselves are stateless — each event is an immutable snapshot of a fact that occurred at a point in time. The event lifecycle, however, defines the valid state transitions for an event object from creation through processing.

### Event Lifecycle States

```text
Created
  ↓
Validated
  ↓
Published
  ↓
Delivered
  ↓
Processed
  ↓
Archived (optional)
```

| State | Description | Transition Trigger |
|-------|-------------|-------------------|
| **Created** | A publisher constructs an event object with all required fields populated | Publisher creates the event |
| **Validated** | The Event Bus validates the event payload against the corresponding Zod schema | Event Bus receives the event from the publisher |
| **Published** | The validated event is accepted by the Event Bus and made available for delivery | Validation passes |
| **Delivered** | The event is dispatched to all registered subscribers | Event Bus delivers to each subscriber |
| **Processed** | Each subscriber has finished processing the event | Subscriber acknowledges receipt |
| **Archived** | (Optional) The event is persisted for replay, audit, or debugging | Configurable retention policy |

### Event Lifecycle Invariants

1. An event cannot transition from `Created` to `Published` without passing through `Validated`
2. An event that fails validation remains in `Created` (or is discarded); it never reaches `Published`
3. An event in `Published` state is immutable — its payload cannot be modified
4. A subscriber that fails to process an event does not prevent delivery to other subscribers
5. An event cannot transition backward (e.g., from `Processed` to `Validated`)
6. `Archived` is an optional terminal state; events may remain in `Processed` indefinitely

---

## Command Flows

N/A — events are asynchronous notifications, not command/response patterns. The Event Bus (SPEC-007) handles command flows for event infrastructure (subscribe, unsubscribe, publish). This specification defines only the event data contracts.

---

## Event Flows

### Publish Flow

```text
Publisher (e.g., Browser Runtime)
  │
  │  constructs a typed event (e.g., BrowserStartedEvent)
  │  assigns eventId, timestamp, version, source, correlationId
  │
  ▼ ──publishes──→
Event Bus (SPEC-007)
  │
  │  receives the event object
  │  validates payload against Zod schema
  │  rejects with EVENT_VALIDATION_FAILED if invalid
  │
  ▼ ──delivers──→
Subscribers (e.g., Visual Context Engine, Diagnostics, Studio State)
  │
  │  receive immutable event snapshot
  │  process independently
  │  one failing subscriber does not interrupt others
```

### Correlation Flow (Capture Lifecycle Example)

```text
Publisher (Browser Runtime)
  │
  │  CAPTURE_STARTED ──events──→ Event Bus
  │    correlationId: "uuid-A"
  │    captureId: "uuid-B"
  │    captureType: "viewport"
  │
  │  (capture operation executes)
  │
  │  CAPTURE_COMPLETED ──events──→ Event Bus
  │    correlationId: "uuid-A"    ← same correlation
  │    captureId: "uuid-B"        ← same capture
  │    screenshotPath: "/path/to/screenshot.png"
  │    durationMs: 342
  │
  │  — or, on failure —
  │
  │  CAPTURE_FAILED ──events──→ Event Bus
  │    correlationId: "uuid-A"    ← same correlation
  │    captureId: "uuid-B"        ← same capture
  │    error: { code: "BR_001", ... }
```

### Subscription Isolation

```text
Subscriber A (Visual Context Engine) ──subscription──→ Event Bus
Subscriber B (Diagnostics)           ──subscription──→ Event Bus
Subscriber C (Studio State)          ──subscription──→ Event Bus

Publisher (Browser Runtime) ──publishes──→ Event Bus
                                            │
                                            ├──delivers──→ Subscriber A
                                            ├──delivers──→ Subscriber B
                                            └──delivers──→ Subscriber C

Subscriber B fails ── does NOT affect delivery to A or C
```

Publishers never know which subscribers consume their events. Subscribers never know which publisher emitted an event beyond the `source` field. No subscriber can modify an event for other subscribers.

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Event payload fails Zod schema validation (`ViskodEventSchema` rejects) | `EVENT_VALIDATION_FAILED` | "Event payload does not match schema for event type `<eventType>`: `<ZodError details>`" | Event rejected by Event Bus; logged; not delivered to any subscriber. Publisher must construct a valid event and republish. |
| Event `eventType` string does not match any known canonical event type | `EVENT_VALIDATION_FAILED` | "Unknown event type `<eventType>`. Expected one of: `<list of canonical event types>`" | Event rejected; logged; not delivered. Publisher must use a canonical event type string constant. |
| Subscriber receives an event with a `version` it does not support (e.g., publisher sends v2.0.0 but subscriber only supports v1.x.x) | `EVENT_VERSION_MISMATCH` | "Event `<eventType>` version `<version>` is not supported by subscriber `<subscriberId>`. Supported versions: `<supportedVersions>`" | Subscriber may ignore the event or emit a diagnostic warning. Publisher should coordinate version upgrades with subscribers. |
| Subscriber receives an event with a known type but an unexpected `source` field value | None (not an error) | N/A | Subscribers should not reject events based on `source`. The `source` field is informational. Events are validated by `eventType`, not by emitter identity. |
| A required `BaseEvent` field is missing (e.g., `eventId`, `timestamp`) | `EVENT_VALIDATION_FAILED` | "Event is missing required field `<fieldName>`" | Event rejected at the Zod schema level (the base fields are part of `ViskodEventSchema`). Publisher must construct a complete event. |

The error codes `EVENT_VALIDATION_FAILED` and `EVENT_VERSION_MISMATCH` are defined in this specification and implemented by the Event Bus (SPEC-007). They conform to the error model defined in SPEC-003.

---

## Security Requirements

* **No secrets in payloads:** Event payloads must never contain passwords, API keys, authentication tokens, session cookies, OAuth credentials, private keys, certificate contents, or any other secret material. This applies to all 14 canonical event payloads and to any future event types.
* **No environment variables in payloads:** Event payloads must never contain raw environment variable values. Subsystem identifiers and configuration values must be explicit strings, not `process.env` references.
* **No PII in payloads:** Event payloads must never contain personally identifiable information (email addresses, usernames, real names, IP addresses, machine hostnames, file paths that embed home directory names).
* **Correlation IDs are opaque:** Correlation IDs must be UUID v4 values that encode no information beyond their role as a linking key. They must not embed user identity, project paths, timestamps, sequence numbers, or any data that could be decoded to reveal context about the developer or their environment.
* **Source field is informational only:** The `source` field identifies the emitting subsystem (e.g., `"browser-runtime"`). It must not be used as an authorization mechanism. Event access control is the responsibility of the Event Bus (SPEC-007), not the `source` field.
* **No file system paths that expose project structure beyond `projectRoot`:** The `projectRoot` field in Project Events is the only path exposed. Screenshot paths in `CaptureCompletedEvent` are relative to the `.viskod/` storage directory. Full absolute paths to source files must not appear in event payloads.
* **All string fields must pass minimum-length validation:** Zod schemas use `.min(1)` on all string fields to prevent empty-string injection.
* **All numeric fields are bounded:** Positive-only, non-negative-only, or integer-only constraints as defined in each schema prevent negative values or floats where integers are expected.

---

## Privacy Requirements

* **No user activity tracking across sessions:** Events describe discrete platform occurrences (browser started, capture completed, etc.). Events must not be used to build user behaviour profiles, track developer productivity, or measure "time spent" in the platform.
* **Correlation IDs must not encode user identity:** As stated in Security Requirements. Every `correlationId` is a fresh UUID v4 generated per causal chain. No static identifier per developer, per machine, or per session may appear in any event field.
* **Event history must be purgeable:** The Event Bus (SPEC-007) must support purging all delivered events from its history buffer. No event retention mechanism may prevent complete deletion of event history.
* **No telemetry events in Phase 1:** Per the Viskod Engineering Constitution, Phase 1 contains no telemetry. This specification defines zero telemetry event types. Adding telemetry event types requires a specification amendment and an RFC.
* **Screenshot paths must be relative:** `CaptureCompletedEvent.screenshotPath` must be a relative path within the `.viskod/` storage directory, not an absolute path that reveals the developer's file system layout.
* **No PII collection:** As stated in Security Requirements. This specification's 14 event payloads carry no fields capable of carrying PII.
* **Data collected:** Event data consists of platform-internal identifiers (UUIDs), performance metrics (durationMs, loadTimeMs), technical metadata (URLs, framework names, viewport dimensions), and diagnostic information (error codes, console messages). None of this constitutes personal data.

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Event object creation (construct and populate all fields) | < 1 ms | `performance.now()` wrap around event constructor call; measured at p95 across 1000 iterations |
| Event payload serialisation (JSON.stringify) | < 2 ms | `performance.now()` wrap around `JSON.stringify(event)`; measured at p95 across 1000 iterations |
| Event payload Zod schema validation (single event) | < 5 ms | `performance.now()` wrap around `schema.parse(event)`; measured at p95 across 1000 iterations |
| Zod schema instantiation (all 14 schemas loaded) | < 10 ms | `performance.now()` around `require('@viskod/event-schema')` schema instantiation; measured at p95 across 100 cold starts |
| Bundle size (tree-shaken, Zod schemas only) | < 4 KB gzipped | Build tool output measurement |

These budgets apply to the event schema package in isolation. The Event Bus (SPEC-007) adds its own overhead for transport, delivery, and subscription management.

The performance targets in `docs/events.md` serve as architectural guidance (event publication < 2 ms, subscriber dispatch < 5 ms, event validation < 2 ms). The targets in this table are the concrete, measurable budgets for the event schema package itself.

---

## Observability

The event schema package itself produces no logs, metrics, or health signals. It is a stateless type and schema library.

Observability concerns for the event system are owned by:

* **SPEC-007 (event-bus):** Emits diagnostic events for publication failures, delivery failures, subscription changes, and validation rejections
* **SPEC-021 (observability):** Defines platform-wide metrics, tracing, and health check infrastructure
* **SPEC-006 (diagnostics):** Collects and surfaces event-related diagnostic signals (e.g., subscriber health, delivery latency, validation failure rate)

---

## Configuration

N/A — the event schema package has no runtime configuration. Event type string constants are hardcoded and exported as string constants. Zod schemas are hardcoded and exported as schema objects.

Any change to an event schema (adding a field, changing a type, removing a field) requires a specification amendment, not a configuration change.

---

## Failure and Recovery

* **Zod validation failure at Event Bus:** The Event Bus rejects the event and logs `EVENT_VALIDATION_FAILED`. The publisher must construct a corrected event and republish. No automatic retry occurs at the schema level.
* **New event type added without updating `ViskodEvent` union:** The discriminated union schema will reject the new event type as unknown. Recovery: add the new event type to the union, to the `ViskodEventSchema` discriminated union, and increment the schema package version.
* **Breaking payload change without version increment:** Existing subscribers that validate against the old schema will successfully receive events because the `version` field has not changed, but their code may not handle the new payload shape. Recovery: increment the `version` field of affected event types. Subscribers should check `event.version` and handle unknown versions gracefully.
* **Subscriber receives event with unknown version:** The subscriber may ignore the event or emit a diagnostic warning (`EVENT_VERSION_MISMATCH`). The publisher should coordinate version upgrades with all known subscribers before incrementing the version.

---

## Compatibility

### Breaking-Change Policy

A change to an event schema is considered breaking if it:

1. **Removes or renames an event type** (e.g., removing `BrowserStartedEvent` from the `ViskodEvent` union)
2. **Changes the `eventType` string literal** of an existing event (e.g., `"BR_EVENT:BROWSER_STARTED"` → `"BR_EVENT:BROWSER_LAUNCHED"`)
3. **Removes a required field** from an event payload (subscribers may depend on that field)
4. **Changes the type of a payload field** (e.g., `loadTimeMs` from `number` to `string`, or `width` from `number` to `{ w: number }`)
5. **Adds a required field** to an event payload without a default value (existing publishers will fail validation)
6. **Tightens a Zod schema constraint** such that previously valid events are rejected (e.g., changing `z.number().nonnegative()` to `z.number().positive()`)
7. **Removes a member from the `ViskodEvent` union**

### Non-Breaking Changes

The following changes are non-breaking and do not require a version increment:

1. Adding a new event type to the `ViskodEvent` union (existing code ignores unknown event types)
2. Adding an optional field to an existing event payload (existing publishers are unaffected; new subscribers can opt in)
3. Adding a new Zod schema (does not affect existing validation)
4. Adding a new event type string constant (does not affect existing constants)

### Migration Strategy

Every breaking change requires:

1. **Schema version increment** for the affected event type (major version per semver)
2. **Deprecation window** of at least one minor version during which both old and new event schemas are published (if backward compatibility is feasible)
3. **Migration guide** documenting the change, rationale, and upgrade steps for publishers and subscribers
4. **Decision record** in `/decisions/` documenting the rationale
5. **Notification** to all subscriber specification owners (SPEC-009, SPEC-006, SPEC-014, SPEC-013, SPEC-015)

### Deprecation Window

* Non-breaking additions (new event types, optional fields): no deprecation window required, available immediately
* Breaking changes: minimum one minor version deprecation window before removal, unless the change is an emergency security fix
* Emergency security fixes: may bypass the deprecation window with documented justification and an immediate version increment

---

## Testing Requirements

### Unit Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| Every payload schema parses a valid payload object | Happy path | Parsed object returned for all 14 schemas |
| Every payload schema rejects an object missing a required field | Invalid input | `ZodError` thrown for all 14 schemas |
| Every payload schema rejects a field with wrong type (e.g., `width: "800"` instead of `width: 800`) | Invalid input | `ZodError` thrown |
| `captureStartedPayloadSchema` rejects `captureType` values outside `"viewport" \| "selection" \| "full-page"` | Invalid input | `ZodError` thrown |
| `diagnosticsUpdatedPayloadSchema` rejects `status` values outside `"healthy" \| "degraded" \| "unavailable" \| "recovering"` | Invalid input | `ZodError` thrown |
| `ViskodEventSchema` parses a valid event of every type (14 tests) | Happy path | Parsed event returned for all 14 types |
| `ViskodEventSchema` rejects an event with unknown `eventType` | Invalid input | `ZodError` thrown |
| `ViskodEventSchema` rejects an event with mismatched payload (e.g., `eventType: "BR_EVENT:BROWSER_STARTED"` but payload has `captureType` field) | Invalid input | `ZodError` thrown |
| `ViskodEventSchema` rejects an event with missing `eventId` | Invalid input | `ZodError` thrown |
| `ViskodEventSchema` rejects an event with non-UUID `eventId` | Invalid input | `ZodError` thrown |
| `ViskodEventSchema` rejects an event with non-ISO-8601 `timestamp` | Invalid input | `ZodError` thrown |
| `ViskodEventSchema` rejects an event with non-semver `version` | Invalid input | `ZodError` thrown |
| `ViskodEventSchema` rejects an event with non-UUID `correlationId` | Invalid input | `ZodError` thrown |
| Every event type string constant matches its regex pattern `^[A-Z]{2,3}_EVENT:[A-Z_]+$` | Convention validation | All 14 constants match |

### Integration Tests

N/A — the event schema package has no runtime dependencies on other packages. Integration is tested implicitly through the Event Bus (SPEC-007) and publisher/subscriber implementations.

### Contract Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| Every event interface defined in this specification exists in the `ViskodEvent` discriminated union | Contract integrity | All 14 event interfaces are present; no extra members |
| Every Zod payload schema has a corresponding event interface | Contract integrity | 14 payload schemas map 1:1 to 14 event interfaces |
| Every `source` field value in `ViskodEventSchema` matches the emitting subsystem in `docs/architecture.md` | Cross-document contract | `"browser-runtime"` for BR events, `"diagnostics"` for DIAG events, `"project-scanner"` for PS events |
| Event type string constants match the event type strings in `docs/events.md` §Event Categories | Cross-document contract | All 14 event type strings match the categories listed in the events specification |
| `BaseEvent<T, P>` fields are present in every `ViskodEvent` member | Contract integrity | `eventId`, `eventType`, `timestamp`, `version`, `source`, `correlationId`, `payload` are on every member |
| All events are immutable at the TypeScript level | Contract integrity | `Readonly` modifier present on all event interfaces (via `DeepReadonly<T>` from SPEC-002, or explicit `readonly` on each field) |

### End-to-End Acceptance Criteria

| Criterion | Verification Method |
|-----------|-------------------|
| A publisher can construct a `BrowserStartedEvent` with all required fields | TypeScript compilation succeeds; Zod validation passes at runtime |
| The Event Bus can validate a `ViskodEvent` using `ViskodEventSchema` and discriminate on `eventType` | Runtime test: publish a valid event of each type; assert `schema.parse(event)` succeeds |
| The Event Bus rejects an invalid event and returns `EVENT_VALIDATION_FAILED` | Runtime test: publish an event with a missing required field; assert rejection |
| A subscriber can narrow `ViskodEvent` to `CaptureCompletedEvent` using the `eventType` discriminant | TypeScript compilation: `switch (event.eventType)` narrows correctly for all 14 cases |
| No secrets appear in any event payload in any test fixture | Manual review + automated scan of all test fixtures for key patterns (`password`, `token`, `secret`, `api_key`) |

---

## Acceptance Criteria

Before this specification can move to Approved:

- [ ] All 14 canonical events defined with typed payloads (5 Browser Lifecycle, 2 Viewport/Selection, 3 Capture, 2 Diagnostics, 2 Project)
- [ ] `BaseEvent<T, P>` extended by every event interface (7-field structure present on all 14)
- [ ] Event type naming convention `{SUBSYSTEM_ABBREV}_EVENT:{EVENT_NAME}` enforced on all 14 event type strings
- [ ] All event payloads validate against corresponding Zod schemas
- [ ] `ViskodEvent` discriminated union covers all 14 event types exhaustively
- [ ] `ViskodEventSchema` discriminated union Zod schema validates all 14 event types at runtime
- [ ] Event `version` field present in all events (semver string)
- [ ] Event `source` field correctly identifies emitting subsystem for all 14 events
- [ ] Event `correlationId` is a UUID v4 on all events
- [ ] No secrets, tokens, passwords, cookies, environment variables, or PII in any payload field (verified by schema review)
- [ ] All numeric fields have appropriate bounds (positive, non-negative, integer)
- [ ] All string fields have minimum-length validation (`.min(1)`)
- [ ] Event type string constants match regex `^[A-Z]{2,3}_EVENT:[A-Z_]+$`
- [ ] Subsystem abbreviations (`BR`, `DIAG`, `PS`) are unique and documented
- [ ] Capture events (started, completed, failed) share `correlationId` semantics documented
- [ ] Error codes `EVENT_VALIDATION_FAILED` and `EVENT_VERSION_MISMATCH` defined
- [ ] Immutability contract documented (events are frozen after publication; consumers receive read-only snapshots)
- [ ] Event lifecycle states (Created, Validated, Published, Delivered, Processed, Archived) defined
- [ ] Security section covers all prohibited payload content categories
- [ ] Privacy section covers data collection, retention, and deletion requirements
- [ ] Performance budgets are numeric with measurement methods
- [ ] All unit tests defined and passable
- [ ] All contract tests defined and passable
- [ ] Breaking-change policy documented with deprecation window
- [ ] No business logic in any schema or type definition — pure data contracts only
- [ ] TypeScript strict mode compatible (all types are fully specified; no `any` types)
- [ ] No lint violations in the event schema package

---

## Open Implementation Decisions

| Decision ID | Description | Resolution |
|-------------|-------------|-----------|
| DEC-010 | Should event `version` be validated against a registry of known versions, or left as a free-form semver string? | Defer to implementation. Free-form semver initially; version registry added if version mismatch errors become frequent. Record in `/decisions/DEC-010.md`. |
| DEC-011 | Should `source` field be validated against a fixed enum of subsystem identifiers at the Event Bus level? | Defer to SPEC-007 (event-bus). The event schema validates `source` as a string literal per event type. The Event Bus may additionally validate against a registry of known subsystems. |
| DEC-012 | Should event serialisation use JSON or a binary format for cross-process transport? | Defer to SPEC-002 DEC-002 (serialisation format). JSON is the default until DEC-002 resolves. Recorded in this specification as a cross-reference. |

---

## Migration Considerations

This is a new specification with no predecessor. No migration from a previous event schema is required.

When the event schema package is first implemented:

1. SPEC-002 (`shared-types`) must expose `BaseEvent<T, P>`, `ViskodError`, `ViskodErrorSchema`, and the base type aliases (`Identifier`, `Timestamp`, `Version`)
2. The Event Bus (SPEC-007) must consume the `ViskodEventSchema` discriminated union Zod schema for runtime validation
3. All publishers (Browser Runtime, Diagnostics, Project Scanner) must import event type interfaces and string constants to construct typed events
4. All subscribers must import `ViskodEvent` for type narrowing on received events

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| New event type needed during Phase 1 implementation that is not in this 14-event catalogue | Medium | Low | Adding a new event type is a non-breaking change. The `ViskodEvent` union and schema can be extended without affecting existing publishers or subscribers. |
| Event payload too small — subscribers need more context than the payload provides | Medium | Medium | Adding optional fields to payloads is a non-breaking change. Subscribers that need more data can request payload extensions. The principle is to start minimal and add fields as needed. |
| Zod discriminated union validation is too slow at scale (< 5 ms target) | Low | Medium | Zod discriminated unions evaluate candidates sequentially. With 14 event types this is well within budget. If the event catalogue grows beyond 50 types, alternative validation strategies (hash-table lookup on `eventType`) may be needed. |
| `source` field string literals diverge from actual subsystem names | Low | Low | Contract tests verify `source` values match architecture documents. TypeScript literal types enforce correctness at compile time. |
| Capture lifecycle correlation breaks if publisher generates mismatched `correlationId` | Low | Medium | The publisher (Browser Runtime) is responsible for consistent correlation. Acceptance tests verify that `CAPTURE_STARTED`, `CAPTURE_COMPLETED`, and `CAPTURE_FAILED` for the same capture share one `correlationId`. |
| Breaking change needed to an event schema before any consumer is stable | Low | Low | All consuming specs are currently Draft. Breaking changes now are cheap. The deprecation window policy takes effect only after the first stable release. |

---

## Implementation Sequence

1. Confirm SPEC-002 (shared-types) is implemented and exposes `BaseEvent<T, P>`, `ViskodError`, `ViskodErrorSchema`, `Identifier`, `Timestamp`, `Version`
2. Create the event schema package directory per SPEC-001 (repository-layout) conventions
3. Implement `src/event-types.ts` — all 14 event type string constants
4. Implement `src/payloads/browser-lifecycle.ts` — 5 Browser Lifecycle payload interfaces and Zod schemas
5. Implement `src/payloads/viewport-selection.ts` — 2 Viewport/Selection payload interfaces and Zod schemas
6. Implement `src/payloads/capture.ts` — 3 Capture payload interfaces and Zod schemas
7. Implement `src/payloads/diagnostics.ts` — 2 Diagnostics payload interfaces and Zod schemas
8. Implement `src/payloads/project.ts` — 2 Project payload interfaces and Zod schemas
9. Implement `src/events.ts` — all 14 event interfaces extending `BaseEvent` with typed payloads
10. Implement `src/viskod-event.ts` — `ViskodEvent` discriminated union type
11. Implement `src/schemas.ts` — `ViskodEventSchema` discriminated union Zod schema
12. Implement `src/index.ts` — barrel re-exports of all payload types, event interfaces, schemas, constants, and the `ViskodEvent` union
13. Write unit tests for all 14 Zod payload schemas (valid and invalid inputs)
14. Write unit tests for `ViskodEventSchema` (valid events of all 14 types, invalid events with wrong types, missing fields, bad payloads)
15. Write contract tests verifying the union covers all 14 types, source fields match architecture, constants match naming convention
16. Write immutability tests (TypeScript `readonly` enforcement)
17. Run TypeScript strict mode compilation
18. Run lint and fix violations
19. Document DEC-010 (version registry) and DEC-012 (serialisation format cross-reference) in `/decisions/`
20. Update SPEC_INDEX.md to mark SPEC-005 status as Approved (promoted from P1 to P0)

---

## Definition of Done

- [ ] Event schema package directory exists with correct structure per SPEC-001
- [ ] `src/event-types.ts` implemented with all 14 event type string constants
- [ ] 14 payload interfaces implemented across 5 category modules
- [ ] 14 event interfaces implemented, each extending `BaseEvent`
- [ ] `ViskodEvent` discriminated union covers all 14 types
- [ ] `ViskodEventSchema` discriminated union Zod schema validates all 14 types at runtime
- [ ] 14 Zod payload schemas implemented
- [ ] All Zod schemas pass unit tests (valid and invalid inputs)
- [ ] `ViskodEventSchema` passes unit tests (valid for all 14 types, rejects invalid)
- [ ] All contract tests pass
- [ ] TypeScript strict mode compiles without errors
- [ ] Zero `any` types in any export
- [ ] Event type string constants match regex `^[A-Z]{2,3}_EVENT:[A-Z_]+$`
- [ ] No secrets, tokens, or PII in any payload field
- [ ] Immutability enforced via TypeScript `readonly` (or `DeepReadonly<T>`)
- [ ] Error codes `EVENT_VALIDATION_FAILED` and `EVENT_VERSION_MISMATCH` defined
- [ ] Event lifecycle documented with state transitions and invariants
- [ ] Security and privacy sections complete
- [ ] Performance budgets are numeric with measurement methods
- [ ] Breaking-change policy documented with deprecation window
- [ ] Package `index.ts` re-exports all public symbols
- [ ] `docs/events.md` event structure and categories are reflected in the schemas
- [ ] Lint passes
- [ ] DEC-010 and DEC-012 documented in `/decisions/`
- [ ] SPEC_INDEX.md updated with Approved status and P0 priority
- [ ] Specification status updated from Draft to Approved
