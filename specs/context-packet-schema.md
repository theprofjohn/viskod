# Context Packet Schema

> **Specification ID:** SPEC-006
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Viskod Engineering
> **Last Updated:** 2026-07-28

---

## Architecture Sources

- `docs/context-packet.md` — full context packet specification, design principles, lifecycle, versioning, ownership
- `docs/architecture.md` §Context Packet, §Context Packet Lifecycle, §Context Packet Evolution, §Packet Assembly — system boundaries and dependency direction
- `docs/visual-context-engine.md` §Stage 8 (Packet Assembly) — VCE processing pipeline, evidence classification, packet assembly stage
- `docs/ARCHITECTURE_BASELINE.md` — canonical subsystem names, runtime boundaries, dependency model

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Planned | Shared type definitions consumed by this specification |

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-009 (visual-context-engine) | Planned | Produces Context Packets via assemblePacket |
| mcp-server | Planned | Exposes Context Packets to AI coding agents via MCP resources and tools |
| sdk | Planned | Consumes Context Packets programmatically |
| public-api | Planned | Exposes Context Packets through versioned public interfaces |

---

## Purpose

This specification defines the **Context Packet** — the canonical, immutable data model produced by Viskod. Every AI coding agent interacting with Viskod ultimately consumes one or more Context Packets. This specification defines the packet structure, all sub-schemas, the lifecycle, immutability guarantees, redaction rules, and serialization constraints.

---

## Scope

- The complete TypeScript schema for Context Packet and all sub-types
- Packet immutability guarantees and enforcement
- Sensitive attribute redaction rules for DOM attributes
- Screenshot path constraints (relative-only)
- Packet size limits
- Schema versioning strategy
- Lifecycle state transitions
- Assembly command flow (VCE → Packet)

---

## Non-Goals

- Serialization format negotiation (JSON is canonical; MessagePack and Protocol Buffers are future concerns)
- MCP tool or resource definitions (those belong to SPEC-mcp-server)
- VCE processing pipeline stages prior to assembly (those belong to SPEC-009)
- Capture Pipeline storage layout (belongs to SPEC-capture-pipeline)
- Transport or wire protocol for packets

---

## Terminology

| Term | Definition |
|------|-----------|
| Context Packet | The canonical, immutable output of Viskod combining all captured evidence for a single capture event |
| Packet Assembly | The final stage of VCE processing in which all evidence sections are combined into a single Context Packet |
| Evidence Source | A subsystem that contributed data to the packet (Browser Runtime, Project Scanner, Selection Engine, Diagnostics, Source Hint Engine) |
| Capture | A single capture event identified by a UUID v4, linked to exactly one Context Packet |
| Redaction | Removal or sanitization of sensitive data before the packet is published |

All other terms follow `docs/glossary.md`.

---

## Runtime Boundary

| Boundary | Responsibility |
|----------|---------------|
| Process | Node.js (VCE process) |
| Owns | Context Packet instances, schema validation, serialization, immutability enforcement |
| Forbidden | Must not access Chromium directly; must not access the filesystem outside `.viskod/`; must not contain MCP communication logic |

---

## Responsibilities

1. Define the full TypeScript schema for Context Packet and all sub-types
2. Guarantee packet immutability after persistence (no mutation API, no setter methods)
3. Embed schema version in every packet for forward-compatible parsing
4. Redact sensitive DOM attributes (passwords, tokens, cookies, secrets) during assembly
5. Constrain screenshot paths to relative references within `.viskod/captures/`
6. Enforce a hard packet size limit of 5 MB
7. Include evidence source attribution for every inference in the packet
8. Ensure deterministic output for identical inputs
9. Validate every packet against the schema before publication

---

## Interfaces

### Public API

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|
| `assemblePacket(evidence: AssembledEvidence): ContextPacket` | Combine all evidence sections into a validated Context Packet | All evidence sections non-null; capture ID present; redaction rules applied to DOM attributes | Returns a validated, immutable ContextPacket; no further mutations possible | `E_VALIDATION_FAILED` — schema validation failure; `E_SIZE_EXCEEDED` — packet exceeds 5 MB; `E_MISSING_REQUIRED_FIELD` — required section absent |
| `validatePacket(packet: ContextPacket): ValidationResult` | Validate a packet against the schema | Packet is fully assembled | Returns a validation result with errors if any | `E_SCHEMA_MISMATCH` — schema version mismatch; `E_INVALID_FIELD` — field fails type or constraint check |
| `serializePacket(packet: ContextPacket): string` | Serialize a packet to canonical JSON | Packet passes validation | Returns deterministic JSON string; identical inputs produce identical output | `E_SERIALIZATION_FAILED` — internal serialization error |

### Events Published

| Event | Payload Schema | When Published |
|-------|---------------|----------------|
| `PacketAssembled` | `{ packetId: string, captureId: string, timestamp: string }` | After a packet passes validation and is persisted |

### Events Subscribed

This specification does not subscribe to events. Packet assembly is a synchronous operation initiated by VCE.

---

## Data Models

### ContextPacket (Root)

```typescript
interface ContextPacket {
  packetId: string;        // UUID v4
  schemaVersion: string;   // semver, e.g., "1.0.0"
  timestamp: string;       // ISO 8601
  captureId: string;       // UUID v4, links to Capture Pipeline
  project?: ProjectMetadata;
  browser: BrowserContext;
  selection: SelectionInfo;
  dom: DOMSummary;
  styles: StyleSummary;
  hierarchy: HierarchySummary;
  screenshots: ScreenshotInfo[];
  diagnostics: DiagnosticEvent[];
  sourceHints: SourceHint[];
  confidence: ConfidenceScores;
  metadata: PacketMetadata;
}
```

### PacketMetadata

```typescript
interface PacketMetadata {
  engineVersion: string;      // VCE version, e.g., "1.0.0"
  processingTimeMs: number;   // total assembly time in milliseconds
  evidenceSources: string[];  // list of subsystems that contributed, e.g., ["browser-runtime", "project-scanner", "diagnostics"]
  redactions: string[];       // what was redacted and why, e.g., ["DOM attribute 'data-token': matched secret pattern"]
}
```

### ProjectMetadata

```typescript
interface ProjectMetadata {
  name: string;
  root: string;              // workspace root path, relative to .viskod root, never absolute
  framework?: string;        // e.g., "react", "vue", "next.js"
  packageManager?: string;   // e.g., "pnpm", "npm", "yarn"
  routes?: RouteInfo[];
}

interface RouteInfo {
  path: string;              // URL path pattern, e.g., "/dashboard/:id"
  file?: string;             // relative file path of the route handler, e.g., "pages/dashboard/[id].tsx"
  confidence: number;        // 0.0–1.0
}
```

### BrowserContext

```typescript
interface BrowserContext {
  url: string;
  viewport: Viewport;
  userAgent: string;
}

interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}
```

### SelectionInfo

```typescript
interface SelectionInfo {
  selector: string;           // CSS selector path
  tagName: string;            // element tag, e.g., "button", "div"
  role?: string;              // ARIA role, e.g., "button", "navigation"
  boundingBox: BoundingBox;
  text?: string;              // visible text content, truncated at 500 chars
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

### DOMSummary

```typescript
interface DOMSummary {
  tagName: string;
  attributes: Record<string, string>;  // non-sensitive attributes only; redaction rules applied
  childCount: number;
  depth: number;                        // depth of this node relative to document root
}
```

### StyleSummary

```typescript
interface StyleSummary {
  computed: Record<string, string>;  // filtered to meaningful properties only (display, position, flex, grid, spacing, typography, colors, sizing, overflow, z-index)
  layout: LayoutInfo;
}

interface LayoutInfo {
  display: string;
  position: string;
  flexDirection?: string;
  gridTemplateColumns?: string;
  width: number;
  height: number;
  margin: Spacing;
  padding: Spacing;
}

interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
```

### HierarchySummary

```typescript
interface HierarchySummary {
  selectedNode: HierarchyNode;
  parents: HierarchyNode[];     // ancestor chain, max 10 nodes
  siblings: HierarchyNode[];    // max 20 nodes
  children: HierarchyNode[];    // max 50 nodes
}

interface HierarchyNode {
  tagName: string;
  id?: string;
  className?: string;
  role?: string;               // ARIA role
  text?: string;               // visible text content, truncated
  depth: number;               // depth relative to document root
}
```

### ScreenshotInfo

```typescript
interface ScreenshotInfo {
  captureId: string;
  type: 'viewport' | 'selection' | 'full-page';
  path: string;                // relative to .viskod/captures/, never absolute
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  sizeBytes: number;
}
```

### DiagnosticEvent

```typescript
interface DiagnosticEvent {
  diagnosticId: string;        // UUID v4
  timestamp: string;           // ISO 8601
  severity: 'error' | 'warning' | 'info';
  category: string;            // e.g., "console", "network", "rendering", "accessibility"
  message: string;
  source?: string;             // e.g., "console.error", "page.on('pageerror')"
  details?: Record<string, unknown>;  // category-specific payload
}
```

### SourceHint

```typescript
interface SourceHint {
  hintId: string;              // UUID v4
  filePath: string;            // relative to workspace root, never absolute
  confidence: number;          // 0.0–1.0
  reason: string;              // e.g., "Matched React component name in DOM attribute __reactFiber"
  framework?: string;          // e.g., "react", "vue"
  discoveryMethod: string;     // e.g., "react-fiber", "vue-devtools", "class-match", "route-match"
  line?: number;               // estimated line number, if available
}
```

### ConfidenceScores

```typescript
interface ConfidenceScores {
  sourceMapping: number;       // 0.0–1.0 — confidence in source hint accuracy
  semanticLabeling: number;    // 0.0–1.0 — confidence in semantic role detection
  layoutAnalysis: number;      // 0.0–1.0 — confidence in layout analysis
  frameworkDetection: number;  // 0.0–1.0 — confidence in framework identification
}
```

### Confidence Rules

- Observed values: confidence is `1.0` (e.g., `boundingBox`, `viewport`, `url`)
- Calculated values: confidence is `0.60–0.99` (e.g., `layoutInfo`, `computed`)
- Inferred values: confidence is `0.01–0.99` (e.g., `sourceHints`, `semanticLabeling`)
- Unknown values: confidence is `0.0`

All `confidence` fields must be in the inclusive range `[0.0, 1.0]`. Validation must reject values outside this range.

---

## State Model

A Context Packet transitions through exactly four states:

```
Building → Validating → Built → Persisted
```

| State | Description | Possible Actions |
|-------|-------------|-----------------|
| **Building** | Evidence sections are being assembled; packet is mutable internally | Add evidence sections; apply redactions; compute confidence scores |
| **Validating** | Schema validation in progress; packet is read-only | Validate required fields; validate field types; validate confidence ranges; validate redaction rules |
| **Built** | Validation passed; packet is structurally complete and immutable | Serialize; persist |
| **Persisted** | Packet is written to durable storage; packet ID is final | Read; expose via MCP; reference from other packets |

### Invariants

- Once in `Persisted` state, the packet is **immutable**. No field may be added, removed, or modified.
- A packet's `packetId` is assigned during `Building` and never changes.
- A packet's `schemaVersion` is set during `Building` and never changes.
- If any observed value changes, a **new packet** with a new `packetId` must be generated. The previous packet must be preserved.
- Historical captures remain reproducible because packets are never modified.

### State Diagram

```
[Evidence Collection] ──→ Building ──→ Validating ──→ Built ──→ Persisted (immutable)
                                │                        │
                                │ validation failed      │ serialization failed
                                ▼                        ▼
                           [Rejected]               [Failed]
                           (discard, retry with     (retry serialization)
                            corrected evidence)
```

---

## Command Flows

### assemblePacket Flow

```
VCE ──calls──→ assemblePacket(evidence)
                        │
                        ▼
               Build packet from evidence sections
                        │
                        ▼
               Apply redaction rules to DOM attributes
                        │
                        ▼
               Compute confidence scores
                        │
                        ▼
               Validate packet against schema
                        │
                        ▼
               Serialize to canonical JSON
                        │
                        ▼
               Persist to .viskod/context/<packetId>.json
                        │
                        ▼
               Return ContextPacket (immutable reference)
```

### validatePacket Flow

```
Consumer ──calls──→ validatePacket(packet)
                        │
                        ▼
               Check schemaVersion is recognized
                        │
                        ▼
               Validate all required fields present
                        │
                        ▼
               Validate all confidence ranges [0.0, 1.0]
                        │
                        ▼
               Validate screenshot paths are relative
                        │
                        ▼
               Validate packet size ≤ 5 MB
                        │
                        ▼
               Return ValidationResult { valid: boolean, errors: string[] }
```

---

## Event Flows

Not applicable. Packet assembly is synchronous. The `PacketAssembled` event is published to the Event Bus after persistence, but this specification does not define the Event Bus protocol.

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Required field missing at top level | `E_MISSING_REQUIRED_FIELD` | `"ContextPacket missing required field '<field>'"` | Reject packet; VCE must retry with corrected evidence |
| Schema version unrecognized | `E_SCHEMA_MISMATCH` | `"Unknown schema version '<version>'"` | Reject packet; consumer should request v1 packet |
| Confidence score out of range | `E_INVALID_CONFIDENCE` | `"Confidence score <value> for '<field>' outside valid range [0.0, 1.0]"` | Reject packet; VCE must recompute confidence |
| Screenshot path is absolute | `E_ABSOLUTE_PATH` | `"Screenshot path '<path>' must be relative to .viskod/captures/"` | Reject packet; VCE must relativize paths |
| Packet exceeds size limit | `E_SIZE_EXCEEDED` | `"Packet size <size> exceeds maximum 5 MB"` | Reject packet; VCE must truncate or compress large sections |
| Redacted attribute found in packet | `E_REDACTION_VIOLATION` | `"Sensitive attribute '<attr>' found in DOMSummary.attributes"` | Reject packet; VCE must apply redaction rules |
| Validation fails for any reason | `E_VALIDATION_FAILED` | `"Packet validation failed: <details>"` | Reject packet; log all validation errors; retry assembly |
| Serialization fails | `E_SERIALIZATION_FAILED` | `"Failed to serialize packet: <reason>"` | Retry serialization; log internal error |

---

## Security Requirements

### Trust Boundaries

- The browser is untrusted. DOM attributes originate from the inspected application and must be treated as hostile input.
- The inspected application is untrusted. It may inject arbitrary HTML, attributes, and JavaScript.
- Repository contents are sensitive. No repository data beyond what is explicitly captured (project name, framework, routes, source hints) may appear in the packet.

### DOM Attribute Redaction

All DOM attributes must be scanned before inclusion in `DOMSummary.attributes`. The following patterns must be redacted:

| Pattern | Examples |
|---------|----------|
| Password-related attributes | `password`, `passwd`, `pwd`, `secret` |
| Token-related attributes | `token`, `accessToken`, `authToken`, `apiKey`, `api-key`, `csrf` |
| Cookie-related attributes | `cookie`, `set-cookie`, `session` |
| Authentication attributes | `auth`, `authenticate`, `authorization`, `jwt` |
| Environment-variable attributes | Attributes whose values match `.env` file patterns (e.g., `VAR=value`) |
| Hidden secrets | `data-secret`, `data-key`, `data-token` |

Redacted attributes must be replaced with the string `"[REDACTED]"` in the `DOMSummary.attributes` record.

Redactions must be logged in `PacketMetadata.redactions` with the format: `"DOM attribute '<attribute-name>': matched redaction pattern '<pattern>'"`.

### Source Hint Path Constraints

- All `SourceHint.filePath` values must be relative to the workspace root.
- No absolute filesystem paths are permitted in any source hint.
- Paths must not traverse above the workspace root (no `../` sequences resolving outside).

### Project Metadata Constraints

- `ProjectMetadata.root` must be a relative path from `.viskod/` storage root, never an absolute path exposing the developer's filesystem.

---

## Privacy Requirements

### Data Collected

- Browser URL (may contain path parameters and query strings)
- DOM tag names, class names, IDs, ARIA roles
- Visible text content (truncated at 500 characters for SelectionInfo; untruncated length is never stored)
- Screenshot image data (stored as files, referenced by relative path)
- Computed CSS property values
- Diagnostic console messages (may contain application log data)

### Data NOT Collected

- Cookies, localStorage, sessionStorage contents
- `.env` file contents
- Authentication tokens or session identifiers
- Network request bodies
- Form input values (including password fields)
- Filesystem paths outside the workspace root
- Application source code (only file paths are referenced)
- User personal information from the operating system

### Retention

Context Packets are retained in `.viskod/context/` until explicitly deleted by the developer. No automatic expiration is enforced by this specification (retention policy belongs to the Capture Pipeline specification).

### Deletion

Deleting the `.viskod/` directory removes all packets and associated captures. No data persists outside `.viskod/`.

### Truncation Rule

`SelectionInfo.text` and `HierarchyNode.text` must be truncated at 500 characters to prevent accidental inclusion of PII or sensitive user data in captured text content.

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Packet assembly (Building stage) | < 50 ms | Timer from start of assemblePacket to packet entering Validating state |
| Serialization (to JSON string) | < 20 ms | Timer from start of JSON.stringify to completion |
| Validation (schema check) | < 30 ms | Timer from start of validatePacket to validation result |
| Total packet size | < 5 MB | Serialized JSON byte length, excluding screenshots (screenshots are referenced by path, not embedded) |

No target like "fast" or "responsive" without a numeric bound.

---

## Observability

### Log Events

| Event | Level | When |
|-------|-------|------|
| `packet.assembly.started` | INFO | assemblePacket invoked |
| `packet.assembly.redaction` | INFO | Each redaction applied (attribute name, pattern matched) |
| `packet.assembly.completed` | INFO | Packet successfully built and validated |
| `packet.validation.failed` | ERROR | Schema validation failure with list of errors |
| `packet.size.limit.warning` | WARN | Packet size exceeds 80% of 5 MB limit (4 MB) |
| `packet.persisted` | INFO | Packet written to durable storage |

### Diagnostic Signals

- `packet.count`: Total number of packets generated (gauge)
- `packet.assembly.duration_ms`: Assembly time per packet (histogram)
- `packet.validation.duration_ms`: Validation time per packet (histogram)
- `packet.size_bytes`: Serialized packet size per packet (histogram)

### Never Log

- Packet contents (screenshots are paths, not base64 data — but paths must still be relative)
- DOM attribute values (except for redaction event logging which records the attribute name, not its value)
- Source hint file contents
- User-visible text content
- Project metadata containing absolute paths

---

## Configuration

| Key | Default | Description | Validation |
|-----|---------|-------------|-----------|
| `contextPacket.maxSizeBytes` | `5242880` (5 MB) | Maximum serialized packet size | Must be positive integer; minimum 1048576 (1 MB) |
| `contextPacket.textTruncationLength` | `500` | Maximum characters for SelectionInfo.text and HierarchyNode.text | Must be positive integer; minimum 50, maximum 10000 |
| `contextPacket.maxParents` | `10` | Maximum ancestor nodes in hierarchy | Must be positive integer; minimum 1, maximum 50 |
| `contextPacket.maxSiblings` | `20` | Maximum sibling nodes in hierarchy | Must be positive integer; minimum 0, maximum 100 |
| `contextPacket.maxChildren` | `50` | Maximum child nodes in hierarchy | Must be positive integer; minimum 0, maximum 200 |

No environment variable mappings are defined. Configuration is provided programmatically by VCE.

---

## Failure and Recovery

### Assembly Failure

If `assemblePacket` fails during `Building`:
- Discard the partial packet
- Log the failure reason with all available evidence
- VCE retries with corrected evidence

If `assemblePacket` fails during `Validating`:
- Reject the packet (state remains `Building` until validation passes)
- Return `E_VALIDATION_FAILED` with the list of errors
- VCE must address validation errors and re-invoke `assemblePacket`

If `assemblePacket` fails during serialization:
- Return `E_SERIALIZATION_FAILED`
- Retry serialization once
- If retry fails, log internal error details and escalate to VCE

### Downstream Consumer Behavior

- Consumers that receive an invalid packet must reject it and request a new capture
- Consumers must never attempt to repair or mutate a received packet
- Consumers should treat `schemaVersion` as authoritative and refuse to parse unknown versions

---

## Compatibility

### Versioning Strategy

- `ContextPacket.schemaVersion` uses semantic versioning (e.g., `1.0.0`)
- Backward-compatible additions (new optional fields) increment the MINOR version
- Breaking changes (removed fields, renamed fields, changed field types) increment the MAJOR version
- Patch version increments for clarifications with no structural changes

### Breaking Change Policy

- Breaking schema changes require a new MAJOR version
- Old schema versions must remain readable for at least one MAJOR version cycle
- Migration documentation must accompany every breaking change

### Deprecation Window

- Deprecated fields remain in the schema for one full MINOR version before removal
- Deprecation is communicated via `PacketMetadata` or changelog

### Forward Compatibility

- Consumers must ignore unknown fields when parsing a packet with a MINOR version higher than expected
- Consumers must reject packets with an unsupported MAJOR version

---

## Testing Requirements

### Unit Tests

1. **Schema validates valid packet** — A fully populated ContextPacket fixture passes validation with zero errors
2. **Schema rejects packets missing required fields** — Omitting `packetId`, `schemaVersion`, `browser`, `selection`, `dom`, `styles`, `hierarchy`, or `metadata` produces `E_MISSING_REQUIRED_FIELD`
3. **Redaction rules applied correctly** — DOM attributes matching redaction patterns (password, token, cookie, secret) are replaced with `"[REDACTED]"`; non-sensitive attributes are preserved
4. **Confidence range validation** — Confidence scores outside `[0.0, 1.0]` are rejected; boundary values `0.0` and `1.0` are accepted
5. **Screenshot path validation** — Absolute paths are rejected with `E_ABSOLUTE_PATH`; relative paths pass
6. **Packet size enforcement** — Packets exceeding 5 MB are rejected with `E_SIZE_EXCEEDED`; packets under 5 MB pass
7. **Text truncation** — `SelectionInfo.text` and `HierarchyNode.text` are truncated at 500 characters
8. **Hierarchy node limits** — `parents` capped at 10, `siblings` capped at 20, `children` capped at 50
9. **Deterministic output** — Identical inputs produce byte-identical serialized JSON (no randomness in timestamps from fixtures)

### Integration Tests

10. **VCE integration** — `assemblePacket` called with VCE-collected evidence produces a valid, validated ContextPacket
11. **Persistence integration** — `Persisted` packet can be deserialized and produces the same data as the in-memory packet

### Contract Tests

12. **Schema matches docs/context-packet.md** — Every field defined in `docs/context-packet.md` has a corresponding type in the schema; no schema field contradicts the architecture document
13. **Packet consumed by MCP tools** — MCP server can deserialize a persisted ContextPacket and expose it as a valid MCP resource

### Snapshot Tests

14. **Canonical packet fixture validates deterministically** — A known-good ContextPacket fixture serializes to a stable snapshot; changing the schema version triggers snapshot failure

### End-to-End Acceptance Criteria

15. A capture initiated through VCE produces a ContextPacket that passes all validation rules
16. An invalid packet (missing required field, out-of-range confidence, absolute screenshot path) is caught by validation and never persisted
17. Two captures with identical inputs produce two distinct packets (different `packetId`, different `timestamp`) with identical structural content
18. A packet with a redacted DOM attribute has the redaction recorded in `PacketMetadata.redactions`

---

## Acceptance Criteria

Before this specification can move to Approved:

- [ ] All sub-schemas defined with concrete TypeScript interfaces (12 top-level sections, 18 total interfaces)
- [ ] Packet includes all 12 required sections: `packetId`, `schemaVersion`, `timestamp`, `captureId`, `project`, `browser`, `selection`, `dom`, `styles`, `hierarchy`, `screenshots`, `diagnostics`, `sourceHints`, `confidence`, `metadata`
- [ ] Schema version embedded in every packet via `schemaVersion` field
- [ ] Sensitive attribute redaction rules defined and testable (6 pattern categories, deterministic replacement)
- [ ] Packet immutability enforced — no mutation API exists; post-`Persisted` state prevents all modifications
- [ ] Screenshot paths are relative (never absolute)
- [ ] Packet size limit defined at 5 MB
- [ ] All 18 unit, integration, contract, snapshot, and E2E tests documented with measurable pass/fail criteria
- [ ] Performance budgets are numeric and measurable (assembly < 50 ms, serialization < 20 ms, validation < 30 ms)
- [ ] Error codes are defined for all 8 failure modes
- [ ] Confidence ranges validated at `[0.0, 1.0]` inclusive
- [ ] State transitions are explicit: `Building → Validating → Built → Persisted`
- [ ] Architecture sources listed and cross-referenced to exact sections
- [ ] No prohibited language (no "fast", "scalable", "secure" without numeric or verifiable definitions)

---

## Open Implementation Decisions

1. Whether `DiagnosticEvent` uses a `diagnosticId` (UUID) or a simpler incrementing counter — specification assumes UUID for consistency with other identifiers
2. Whether screenshot image data should ever be embedded inline vs always referenced by path — specification mandates path-only; embedding is a future concern
3. Whether `RouteInfo.confidence` should use the `ConfidenceScores` structure or remain independent — specification keeps it independent as a single scalar
4. Exact discovery method strings for `SourceHint.discoveryMethod` — specification lists examples; exhaustive enumeration deferred to Source Hint Engine specification
5. Compression of large sections (e.g., `computed` styles) at rest — specification defers to Packet Assembly implementation

---

## Migration Considerations

This is the initial specification. No migration from a prior version is required.

Future migration paths:
- Schema v1 → v2: Additive fields only (new optional sections); v1 consumers ignore unknown fields
- Schema v1 → v3 (breaking): New MAJOR version; v1 packets readable by v3 consumers; v3 packets rejected by v1 consumers

---

## Risks

- **Schema churn:** If the Context Packet schema changes frequently, consumers (MCP Server, SDK, public API) must constantly update parsing logic. Mitigation: strict versioning; additive-only changes for MINOR versions.
- **Size creep:** As new evidence sources are added, packet size may grow beyond 5 MB. Mitigation: hard limit enforced at validation; compression considered for future versions.
- **Redaction completeness:** New DOM attribute patterns may evade current redaction rules. Mitigation: redaction rules are configurable; `PacketMetadata.redactions` provides audit trail.
- **Determinism failure:** Browser or system-specific data (user agent, viewport metrics) must be captured faithfully but should not affect structural determinism. Mitigation: timestamp and metadata are the only non-deterministic fields.

---

## Implementation Sequence

1. Define all TypeScript interfaces in `packages/shared/src/schemas/context-packet.ts`
2. Implement `assemblePacket` in `packages/context-engine/src/assembly.ts`
3. Implement schema validation (Zod) in `packages/context-engine/src/validation.ts`
4. Implement redaction engine in `packages/context-engine/src/redaction.ts`
5. Implement serialization in `packages/context-engine/src/serialization.ts`
6. Write unit tests for all interfaces and validation rules
7. Write integration tests with VCE
8. Write snapshot tests with canonical fixture
9. Write contract tests against `docs/context-packet.md`
10. Update `docs/context-packet.md` if schema diverges from document (document is authoritative until specification is Approved)

---

## Definition of Done

- [ ] All TypeScript interfaces defined, exported, and documented
- [ ] Zod validation schemas generated from interfaces
- [ ] `assemblePacket` produces valid packets from valid evidence
- [ ] `assemblePacket` rejects invalid evidence with specific error codes
- [ ] Redaction engine covers all 6 pattern categories
- [ ] Redaction audit trail appears in `PacketMetadata.redactions`
- [ ] Packet immutability enforced (TypeScript `readonly` or `Object.freeze`)
- [ ] All 18 tests pass
- [ ] Lint passes
- [ ] Typecheck passes
- [ ] Performance budgets confirmed with benchmarks
- [ ] No known regressions introduced
- [ ] `docs/context-packet.md` reviewed for consistency with this specification
