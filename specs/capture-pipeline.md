# Capture Pipeline

> **Specification ID:** SPEC-010
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Viskod Engineering
> **Last Updated:** 2026-07-28

---

## Architecture Sources

- `docs/capture-pipeline.md` — full subsystem specification: design philosophy, pipeline overview, persistence stage, invariants
- `docs/architecture.md` §Capture Pipeline — subsystem responsibility: queue captures, persist files, assign capture IDs, retention policy, export
- `docs/architecture.md` §Screenshot Pipeline — three screenshot types per capture; never overwrite previous captures
- `docs/architecture.md` §Storage Layout — `.viskod/` directory structure: `captures/`, `context/`, `logs/`, `cache/`, `settings.json`
- `docs/architecture.md` §Persistence — persistent data: captured context, screenshots, logs, settings; ephemeral data: DOM, browser, selection, hover state, events
- `docs/architecture.md` §Data Ownership — Capture Pipeline owns screenshot storage, capture metadata, retention, export
- `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries — Capture Pipeline: owns screenshot storage, capture metadata, retention, export; forbidden: browser, DOM, analysis
- `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names — Capture Pipeline is the canonical name; "Capture Manager" and `capture-manager/` are forbidden alternatives
- `docs/ARCHITECTURE_BASELINE.md` §Canonical Dependency Model — VCE → Capture Pipeline (command invocation); no reverse dependency
- `docs/glossary.md` §Capture Pipeline — the subsystem responsible for persisting, managing and exporting captured evidence; never analyses data or interacts with the browser directly

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Draft | Consumes base types (`Identifier`, `Timestamp`, `FilePath`, `Bytes`, `Result<T, E>`), constants (`VISKOD_STORAGE_DIR`, `CAPTURE_DIR`), error classification (`ErrorCategory`, `ViskodError`) |
| SPEC-003 (error-model) | Draft | Consumes structured error codes, categories, severity, and recovery suggestions for all capture pipeline error conditions |
| SPEC-006 (context-packet-schema) | Draft | Consumes `ContextPacket` type — the input to `persistCapture`; `StoredCapture` fields must remain consistent with `ContextPacket` fields |
| SPEC-018 (storage-schema) | Draft (deferred) | When approved, Capture Pipeline delegates direct filesystem operations to the storage abstraction. The public interface (`persistCapture`, `getCapture`, etc.) remains unchanged. See §Compatibility for migration note. |

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-009 (visual-context-engine) | Draft | Calls `persistCapture` after packet assembly to store the capture and associated screenshots; VCE is the sole producer of captures into the pipeline |
| Studio | Draft | Calls `getCapture`, `listCaptures`, `exportCapture`, `deleteCapture`, `getStorageStats` for display and management in the human interface |
| CLI | Draft | Calls `runRetentionCleanup` during maintenance operations |

---

## Purpose

This specification defines the **Capture Pipeline** — the subsystem responsible for persisting and managing captured visual evidence. After the Visual Context Engine assembles a Context Packet and the Browser Runtime produces screenshots, the Capture Pipeline writes them to durable storage, manages their lifecycle, enforces retention policies, provides retrieval and export capabilities, and maintains storage statistics.

The Capture Pipeline is a storage and lifecycle manager. It never analyses data, controls the browser, generates source hints, or communicates with AI agents. Its single responsibility is to ensure captures are durably stored, retrievable, and properly managed throughout their lifecycle.

---

## Scope

- Screenshot file persistence (viewport, selection, full-page) to `.viskod/captures/{captureId}/`
- Capture metadata persistence (`metadata.json`) within each capture directory
- Capture retrieval by ID (`getCapture`)
- Capture listing with optional filters (`listCaptures`)
- Capture export to a specified filesystem path (`exportCapture`)
- Capture deletion with associated screenshot cleanup (`deleteCapture`)
- Storage statistics collection (`getStorageStats`)
- Retention cleanup based on configurable retention period (`runRetentionCleanup`)
- Capture ID validation (UUID v4) before all directory operations
- Atomic write guarantees — no partial files on failure
- Storage full detection (reject new captures when disk space drops below 50 MB)
- Inline storage layout (until SPEC-018 supersedes the implementation)

---

## Non-Goals

- Data analysis — semantic interpretation of captures belongs to the Visual Context Engine (SPEC-009)
- Browser interaction — screenshot capture, navigation, viewport management belong to the Browser Runtime
- Source mapping — source file hint generation belongs to the Source Hint Engine
- MCP exposure — MCP tool and resource definitions belong to the MCP Server specification
- DOM inspection or style computation — evidence collection belongs to VCE and Browser Runtime
- Network communication — all operations are local filesystem I/O
- Context Packet schema definition — packet structure belongs to SPEC-006
- Event publishing — the Capture Pipeline is a synchronous service; all event publishing is done by Browser Runtime before VCE calls the pipeline
- Screenshot generation — the Capture Pipeline writes screenshot buffers to disk; screenshot capture is the Browser Runtime's responsibility
- Cloud storage or remote backup — Phase 1 is local-first only

---

## Terminology

Reference `docs/glossary.md` for all canonical terms. Define only implementation-specific terms here.

| Term | Definition |
|------|-----------|
| Capture | A single capture event identified by a UUID v4, consisting of a Context Packet and zero or more screenshots |
| Capture Directory | A subdirectory within `.viskod/captures/` named by capture ID, containing `metadata.json` and screenshot files |
| metadata.json | The canonical metadata file within each capture directory, containing `CaptureMetadata` with all references relative to the capture directory |
| Storage Full | The condition where available disk space on the volume hosting `.viskod/` drops below the configurable threshold (default: 50 MB) |
| Retention Cleanup | The periodic operation that enumerates capture directories and deletes those older than the configured retention period, preserving at minimum the most recent capture |
| Atomic Write | A write operation that either completes in full (all files written, no partial state) or cleans up all partial artifacts — never leaving an incomplete capture directory |

---

## Runtime Boundary

| Boundary | Responsibility |
|----------|---------------|
| Process | Main desktop process |
| Owns | Screenshot file storage, capture metadata persistence, capture lifecycle management, retention policy enforcement, storage statistics, capture export |
| Imports Allowed | `shared-types` (SPEC-002), `error-model` (SPEC-003), `context-packet-schema` (SPEC-006), `fs/path` (Node.js built-in) |
| Imports Forbidden | `browser-runtime`, `visual-context-engine`, `mcp-server`, `project-scanner`, `source-hint-engine`, `playwright`, any browser module, any DOM API |
| Never Accesses | Browser DOM, browser runtime state, network I/O, Playwright APIs, repository files outside `.viskod/`, MCP transport |

---

## Responsibilities

1. **Persist captures** — accept a `ContextPacket` and `Screenshot[]` from VCE; create the capture directory; write each screenshot buffer to file; write `metadata.json`; return a `StoredCapture` on success
2. **Retrieve captures** — accept a capture ID; read `metadata.json` from the capture directory; return a `StoredCapture`
3. **List captures** — enumerate all capture directories; assemble `StoredCapture` records; apply optional filters (date range, page URL, tags); apply pagination (offset, limit)
4. **Export captures** — copy a capture directory (metadata + screenshots) to a user-specified export path
5. **Delete captures** — remove the capture directory and all contained files
6. **Report storage statistics** — count captures, aggregate total size, report oldest and newest capture timestamps, report available disk space
7. **Enforce retention** — enumerate captures older than the retention period; delete them; preserve at minimum the most recent capture as a safety measure
8. **Validate inputs** — validate every capture ID as UUID v4 before any filesystem operation
9. **Enforce storage full guard** — reject `persistCapture` when available disk space drops below the configurable threshold
10. **Guarantee atomic writes** — no partial files remain on write failure; cleanup removes all artifacts from a failed persist
11. **Maintain path safety** — all paths are relative to `.viskod/captures/`; no absolute path traversal; no files outside the capture directory
12. **Contain zero browser logic** — no imports from browser-runtime; no Playwright usage; no DOM APIs
13. **Contain zero analysis logic** — no imports from visual-context-engine; no semantic interpretation of capture data

---

## Interfaces

### Public API

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|
| `persistCapture(packet: ContextPacket, screenshots: Screenshot[]): Promise<Result<StoredCapture>>` | Store a capture persistently on disk. Called by VCE after packet assembly. | `screenshots` array is non-empty; `packet.captureId` is valid UUID v4; available disk space is ≥ 50 MB above the storage directory | Capture directory created at `.viskod/captures/{captureId}/`; all screenshot buffers written to files; `metadata.json` written; `StoredCapture` returned | `CP_STORAGE_FULL`, `CP_WRITE_FAILED`, `CP_INVALID_CAPTURE_ID` |
| `getCapture(captureId: string): Promise<Result<StoredCapture>>` | Retrieve a stored capture by ID. | `captureId` is valid UUID v4; capture directory exists | `StoredCapture` returned with all metadata fields populated | `CP_CAPTURE_NOT_FOUND`, `CP_INVALID_CAPTURE_ID`, `CP_METADATA_CORRUPT` |
| `listCaptures(filter?: CaptureFilter): Promise<Result<StoredCapture[]>>` | List captures with optional filters and pagination. | None (empty filter returns all captures with default pagination) | Array of `StoredCapture` records returned; sorted by timestamp descending (newest first); respects `limit` and `offset` | None (empty list returned when no captures match) |
| `exportCapture(captureId: string, exportPath: string): Promise<Result<void>>` | Export a capture directory to a specified path. | `captureId` is valid UUID v4; capture exists; `exportPath` is a writable directory | Capture directory contents (metadata + screenshots) copied to `exportPath` | `CP_CAPTURE_NOT_FOUND`, `CP_INVALID_CAPTURE_ID`, `CP_EXPORT_FAILED` |
| `deleteCapture(captureId: string): Promise<Result<void>>` | Permanently delete a capture and all associated screenshots. | `captureId` is valid UUID v4; capture directory exists | Capture directory and all contents recursively removed; no recovery possible | `CP_CAPTURE_NOT_FOUND`, `CP_INVALID_CAPTURE_ID` |
| `getStorageStats(): Promise<Result<CaptureStorageStats>>` | Get storage statistics for all captures. | None | `CaptureStorageStats` returned with current counts, sizes, dates, and available space | None (stats reflect current state even if zero captures) |
| `runRetentionCleanup(retentionDays: number): Promise<Result<number>>` | Delete captures older than the retention period. Return count deleted. | `retentionDays` is a non-negative integer | All captures older than `retentionDays` deleted except the single most recent capture; count of deleted captures returned | `CP_RETENTION_INVALID` |

### Events Published

The Capture Pipeline publishes **no events**. It is called synchronously by the Visual Context Engine. All event publishing (`CaptureCompleted`, etc.) is done by Browser Runtime before VCE calls the Capture Pipeline. The pipeline's only contract with other subsystems is its synchronous public API.

### Events Subscribed

The Capture Pipeline subscribes to **no events**. It has no event bus dependency.

---

## Data Models

### Screenshot (Input to persistCapture)

```typescript
interface Screenshot {
  captureId: string;              // UUID v4
  type: 'viewport' | 'selection' | 'full-page';
  buffer: Buffer;                 // raw image bytes
  format: 'png' | 'jpeg';
  width: number;
  height: number;
}
```

### StoredCapture (Output from persistCapture, getCapture, listCaptures)

```typescript
interface StoredCapture {
  captureId: string;              // UUID v4
  packetId: string;               // UUID v4, links to ContextPacket
  timestamp: string;              // ISO 8601
  screenshotCount: number;
  totalSizeBytes: number;         // aggregate size of all screenshot files
  retentionDays?: number;         // configured retention period at time of capture
  tags?: string[];                // user-assigned tags
  page: {
    url: string;
    viewport: {
      width: number;
      height: number;
    };
  };
}
```

### CaptureFilter (Input to listCaptures)

```typescript
interface CaptureFilter {
  fromDate?: string;              // ISO 8601 — captures with timestamp >= fromDate
  toDate?: string;                // ISO 8601 — captures with timestamp <= toDate
  pageUrl?: string;               // partial URL match (case-insensitive substring)
  tags?: string[];                // captures matching any of the specified tags (OR semantics)
  limit?: number;                 // default: 50
  offset?: number;                // default: 0
}
```

### CaptureStorageStats (Output from getStorageStats)

```typescript
interface CaptureStorageStats {
  totalCaptures: number;
  totalSizeBytes: number;         // aggregate size of all capture directories
  availableSpaceBytes: number;    // free disk space on the volume hosting .viskod/
  oldestCaptureDate: string;      // ISO 8601 timestamp of the oldest capture
  newestCaptureDate: string;      // ISO 8601 timestamp of the newest capture
}
```

### CaptureMetadata (On-disk schema: .viskod/captures/{captureId}/metadata.json)

```typescript
interface CaptureMetadata {
  captureId: string;              // UUID v4
  packetId: string;               // UUID v4
  schemaVersion: string;          // semver of the metadata schema, e.g., "1.0.0"
  createdAt: string;              // ISO 8601
  screenshots: {
    type: 'viewport' | 'selection' | 'full-page';
    path: string;                 // relative to the capture directory, e.g., "viewport.png"
    format: 'png' | 'jpeg';
    width: number;
    height: number;
    sizeBytes: number;
  }[];
  page: {
    url: string;
    viewport: {
      width: number;
      height: number;
    };
  };
  tags: string[];
}
```

### Storage Layout

```
.viskod/
  captures/
    {captureId}/
      metadata.json    — CaptureMetadata (all paths relative to this directory)
      viewport.png     — optional
      selection.png    — optional
      full-page.png    — optional
  context/
    {packetId}.json    — managed by VCE, referenced by captureId via packetId
```

### Schema Alignment with SPEC-006

`StoredCapture` fields must remain consistent with the corresponding `ContextPacket` fields:

| StoredCapture field | ContextPacket field | Constraint |
|---------------------|---------------------|-----------|
| `captureId` | `captureId` | Same UUID v4 |
| `packetId` | `packetId` | Same UUID v4 |
| `timestamp` | `timestamp` | Same ISO 8601 value |
| `page.url` | `browser.url` | Same URL string |
| `page.viewport` | `browser.viewport` | Same width/height (deviceScaleFactor stored in packet only) |

This alignment is validated by contract tests.

---

## State Model

### Capture Job Lifecycle

```
Pending → Persisting → Persisted
              ↓              ↓
         Failed        Deleted (cleanup)
```

| State | Description | Actions |
|-------|-------------|---------|
| **Pending** | Capture request received from VCE; `ContextPacket` and `Screenshot[]` buffered in memory; directory not yet created | Validate capture ID; check storage space |
| **Persisting** | Capture directory created; screenshot buffers being written to files; metadata being assembled | Write screenshots; write metadata.json |
| **Persisted** | All files written successfully; `metadata.json` created; capture is immutable | Read; export; delete |
| **Failed** | Disk write error or storage full during persisting; all partial artifacts cleaned up | Inspect error; retry if recoverable |
| **Deleted** | Capture directory removed by retention cleanup or explicit `deleteCapture` | None (directory no longer exists) |

### Invariants

- A capture in `Persisted` state is **immutable**. No files within the capture directory shall be modified after `metadata.json` is written.
- If `Persisting` fails, **no artifacts remain**. The capture directory is cleaned up before the error is returned.
- `captureId` is assigned during `Pending` state and never changes throughout the capture's lifetime.
- Screenshot file paths in `metadata.json` are **always relative** to the capture directory. Absolute paths violate the security boundary.
- The most recent capture (by `createdAt` timestamp) is **never deleted** by retention cleanup, regardless of age.

### State Transitions

```
[VCE calls persistCapture]
        │
        ▼
    Pending
        │
        │ validate captureId format
        │ check storage space
        │
        ▼
    Persisting ──[write error]──→ Failed (cleanup partial files, return error)
        │
        │ all files written
        │ metadata.json created
        │
        ▼
    Persisted (immutable)
        │
        ├──[deleteCapture called]──→ Deleted
        │
        └──[retentionCleanup: age > retentionDays]──→ Deleted
```

---

## Command Flows

### persistCapture

```
VCE ──calls──→ CapturePipeline.persistCapture(packet, screenshots)
                        │
                        ▼
               Validate captureId is UUID v4
                        │
                        ▼
               Check available disk space ≥ 50 MB
                        │
                        ▼
               Create directory: .viskod/captures/{captureId}/
                        │
                        ▼
               For each screenshot in screenshots:
                 ┌─► Write buffer to {type}.{format}
                 │   Record file path (relative), size, dimensions
                 │   On write failure: delete all written files, remove directory, return CP_WRITE_FAILED
                 │
                 └── (repeat for all screenshots)
                        │
                        ▼
               Assemble CaptureMetadata from packet + screenshot records
                        │
                        ▼
               Write metadata.json (atomic: write to temp, rename to final)
                        │
                        ▼
               Return Result.ok({ StoredCapture })
                        │
                        └── On any failure: clean up partial directory, return Result.err(error)
```

### getCapture

```
Caller ──calls──→ CapturePipeline.getCapture(captureId)
                        │
                        ▼
               Validate captureId is UUID v4
                        │
                        ▼
               Check if .viskod/captures/{captureId}/ exists
                        │
                        ▼
               Read metadata.json
                        │
                        ▼
               Parse CaptureMetadata from JSON
                        │
                        ▼
               Transform to StoredCapture
                        │
                        ▼
               Return Result.ok(storedCapture)
                        │
                        ├── captureId invalid ──→ return Result.err(CP_INVALID_CAPTURE_ID)
                        ├── directory missing ──→ return Result.err(CP_CAPTURE_NOT_FOUND)
                        └── metadata unparseable ──→ return Result.err(CP_METADATA_CORRUPT)
```

### runRetentionCleanup

```
CapturePipeline.runRetentionCleanup(retentionDays)
                        │
                        ▼
               Validate retentionDays ≥ 0
                        │
                        ▼
               Enumerate all capture directories in .viskod/captures/
                        │
                        ▼
               Read metadata.json from each; extract createdAt
                        │
                        ▼
               Sort captures by createdAt descending
                        │
                        ▼
               Identify the most recent capture — mark as preserved
                        │
                        ▼
               For each capture where (now - createdAt) > retentionDays:
                 ├── Skip if it is the most recent capture
                 └── Delete directory recursively
                        │
                        ▼
               Return Result.ok(count of deleted captures)
                        │
                        └── retentionDays < 0 ──→ return Result.err(CP_RETENTION_INVALID)
```

---

## Event Flows

The Capture Pipeline publishes **no events** and subscribes to **no events**. It is a purely synchronous service.

The separation of concerns is:

1. **Browser Runtime** captures screenshots and publishes `CaptureCompleted` events
2. **Visual Context Engine** subscribes to Browser Runtime events, assembles Context Packets, and calls `CapturePipeline.persistCapture`
3. **Capture Pipeline** persists to disk and returns a result — it never publishes events

This keeps the pipeline's surface area minimal and prevents distributed coupling through the Event Bus.

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Capture directory does not exist for the requested `captureId` | `CP_CAPTURE_NOT_FOUND` | `"Capture '<captureId>' not found"` | Return error; no state change; caller can retry with valid ID |
| Available disk space is below the threshold (default: 50 MB) | `CP_STORAGE_FULL` | `"Storage full: <availableBytes> bytes available, minimum <thresholdBytes> bytes required"` | Return error; reject new captures; caller should free disk space or notify user |
| Disk I/O error during file write (screenshot buffer or metadata) | `CP_WRITE_FAILED` | `"Write failed for '<filePath>': <osError>"` | Clean up all partial files in the capture directory; remove the directory; return error; caller may retry |
| `captureId` is not a valid UUID v4 | `CP_INVALID_CAPTURE_ID` | `"Invalid capture ID '<captureId>': must be UUID v4"` | Return error immediately; no filesystem access performed |
| `metadata.json` exists but is unparseable (malformed JSON, missing required fields) | `CP_METADATA_CORRUPT` | `"Metadata corrupt for capture '<captureId>' at '<path>'": <parseError>"` | Return error with full path to metadata; caller should consider the capture unrecoverable |
| Export destination path is not writable (directory does not exist, permission denied, disk full) | `CP_EXPORT_FAILED` | `"Export failed to '<exportPath>': <osError>"` | Return error; no state change to the stored capture; caller should verify path and permissions |
| `retentionDays` is negative | `CP_RETENTION_INVALID` | `"Invalid retention period '<retentionDays>': must be non-negative integer"` | Return error immediately; no captures deleted |
| `screenshots` array is empty when calling `persistCapture` | `CP_NO_SCREENSHOTS` | `"persistCapture requires at least one screenshot"` | Return error; no directory created |
| `packet.captureId` does not match any screenshot's `captureId` | `CP_ID_MISMATCH` | `"captureId mismatch: packet '<packetId>' vs screenshot '<screenshotId>'"` | Return error; no files written |

All errors conform to `ViskodError` from SPEC-002. Every error includes: `code`, `category: ErrorCategory.STORAGE`, `severity` (as specified above), `message`, `correlationId`, `recoverable` flag, and optional `metadata` with path and OS error details.

---

## Security Requirements

### Path Safety

- All capture directory paths are constructed as relative paths under `.viskod/captures/`
- `captureId` is always validated as UUID v4 before any path construction — this prevents path traversal injection
- `captureId` must match the regex `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` (UUID v4)
- All screenshot file paths in `metadata.json` are **relative** to the capture directory — absolute paths are never written
- Export operations copy files, never move or symlink

### Trust Boundaries

- The input `packet` and `screenshots` originate from the Visual Context Engine, which runs in the same process — VCE is trusted
- The filesystem is the primary trust boundary — filesystem operations may fail for reasons outside Viskod's control (disk full, permission denied, filesystem corruption)
- The export path (`exportPath`) is user-provided and must be validated: must be a writable directory, not within `.viskod/` (prevent accidental deletion of source capture)

### Input Validation

- `captureId`: UUID v4 regex validation before any filesystem operation
- `retentionDays`: non-negative integer validation
- `exportPath`: must exist and be a writable directory; must not be within `.viskod/captures/`
- `filter.limit`: must be a positive integer ≤ 500; clamped to 50 if missing, clamped to 500 if exceeding
- `filter.offset`: must be a non-negative integer; defaults to 0

### Prohibited Operations

- Never reads files outside `.viskod/captures/`
- Never creates directories outside `.viskod/captures/`
- Never follows symlinks during export (prevent symlink-based traversal)
- Never writes to `.viskod/context/` (that directory is owned by VCE)
- Never reads `.viskod/settings.json` (configuration is injected, not read from disk by this subsystem)

---

## Privacy Requirements

### Data Collected

The Capture Pipeline stores:
- Screenshot image data (PNG or JPEG) — written to disk as files
- Capture metadata (URL, viewport dimensions, timestamps, tags) — written to `metadata.json`

### Data NOT Collected

- Cookies, localStorage, sessionStorage contents
- Form input values, passwords, or sensitive field contents (screenshots may capture visual rendering — the pipeline itself does not inspect or extract text)
- Network request or response payloads
- Environment variables
- Authentication tokens or session identifiers
- Repository source code
- Operating system user information

### Retention

- Default retention period: 30 days (configurable via SPEC-004)
- `runRetentionCleanup` enforces the retention period
- The most recent capture is always preserved regardless of age (safety guarantee)
- No automatic cleanup runs without explicit invocation — the pipeline does not schedule background tasks

### Deletion

- `deleteCapture` permanently removes the capture directory and all contained files
- No soft-delete, no trash, no recycle bin — deletion is immediate and irreversible
- `runRetentionCleanup` performs bulk deletion of expired captures
- Deletion disposes of both metadata and screenshot files

### Export

- `exportCapture` copies data to a user-specified path
- Export requires an explicit API call — no automatic export or upload
- Export does not alter the source capture; it creates a copy

### Telemetry

- No telemetry is collected in Phase 1 per the Viskod Engineering Constitution
- No capture counts, sizes, or statistics are transmitted externally
- All statistics (`getStorageStats`) are locality-constrained to the developer's machine

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| `persistCapture` latency (3 screenshots, ~2 MB total) | < 200 ms | Timer from function entry to return; excludes screenshot generation (owned by BR) |
| `getCapture` latency | < 10 ms | Timer from function entry to return; single metadata.json read + parse |
| `deleteCapture` latency | < 50 ms | Timer from function entry to return; recursive directory removal |
| `runRetentionCleanup` latency per 100 captures | < 100 ms | Timer normalized to 100 capture directories enumerated and filtered |
| `listCaptures` latency (no filter, 100 captures) | < 50 ms | Timer from function entry to return; enumeration + metadata reads |
| `exportCapture` latency (3 screenshots, ~2 MB total) | < 500 ms | Timer from function entry to copy completion |
| `getStorageStats` latency | < 20 ms | Timer from function entry to return; directory enumeration + size aggregation |
| Capture directory metadata overhead | < 1 KB per capture | `metadata.json` file size on disk |

No target like "fast" or "responsive" without a numeric bound.

---

## Observability

### Log Events

| Event | Level | When | Correlation ID |
|-------|-------|------|---------------|
| `capture.persist.started` | INFO | `persistCapture` invoked | Generated per call |
| `capture.persist.completed` | INFO | Capture successfully persisted | Same as started |
| `capture.persist.failed` | ERROR | Write failure during persist | Same as started |
| `capture.storage.full` | ERROR | `CP_STORAGE_FULL` rejected a capture | Generated per call |
| `capture.deleted` | INFO | Capture deleted via `deleteCapture` or retention cleanup | captureId |
| `capture.retention.started` | INFO | `runRetentionCleanup` invoked | Generated per call |
| `capture.retention.completed` | INFO | Retention cleanup finished with count | Same as started |
| `capture.export.failed` | ERROR | Export operation failed | captureId |
| `capture.metadata.corrupt` | ERROR | `metadata.json` is unparseable | captureId |

### Diagnostic Signals

The Capture Pipeline exposes storage statistics through `getStorageStats()`:
- `totalCaptures` — current capture count
- `totalSizeBytes` — aggregate storage usage
- `availableSpaceBytes` — free disk space
- `oldestCaptureDate` — oldest capture timestamp
- `newestCaptureDate` — newest capture timestamp

### Never Log

- Screenshot file contents or image data
- Capture metadata values beyond capture ID and timestamps
- Absolute filesystem paths outside `.viskod/`
- User tags (may contain sensitive descriptions)

---

## Configuration

| Key | Default | Description | Validation |
|-----|---------|-------------|-----------|
| `capture.retentionDays` | `30` | Number of days captures are retained before cleanup | Must be non-negative integer |
| `capture.storageThresholdBytes` | `52428800` (50 MB) | Minimum free disk space required to accept new captures | Must be positive integer |
| `capture.screenshotFormat` | `'png'` | Default screenshot format for new captures | Must be `'png'` or `'jpeg'` |
| `capture.listDefaultLimit` | `50` | Default limit for `listCaptures` when no filter is provided | Must be positive integer ≤ 500 |
| `capture.listMaxLimit` | `500` | Maximum allowed limit for `listCaptures` | Must be positive integer |

Configuration is injected at construction time. The Capture Pipeline does not read `.viskod/settings.json` directly. Configuration values are provided by the subsystem that creates the pipeline instance (typically the CLI or a configuration provider from SPEC-004).

---

## Failure and Recovery

### persistCapture Failure

If `persistCapture` fails during the `Persisting` state:
- All written files within `.viskod/captures/{captureId}/` are deleted
- The capture directory is removed
- No partial artifacts remain on disk
- The error (`CP_WRITE_FAILED` or `CP_STORAGE_FULL`) is returned to the caller
- The caller (VCE) may retry with the same data after the underlying issue is resolved

### metadata.json Corruption

If `metadata.json` becomes unparseable (disk corruption, manual edit):
- `getCapture` returns `CP_METADATA_CORRUPT` with the full file path
- `listCaptures` skips the corrupted capture (excludes it from results, logs warning)
- `deleteCapture` can still delete the capture (directory removal does not depend on metadata validity)
- `runRetentionCleanup` skips captures with corrupt metadata (cannot determine age)

### Disk Full Recovery

When the storage threshold is breached:
- New captures are rejected with `CP_STORAGE_FULL`
- Existing captures remain readable and exportable
- `runRetentionCleanup` can be called to free space by removing expired captures
- `deleteCapture` can be called to free space by removing specific captures

### Downstream Behavior

- VCE receives `Result.err` from `persistCapture` — it should log the error and may offer retry to the user
- Studio receives `Result.err` from read/export/delete operations — it should display the error message and recovery suggestion to the user
- CLI reports retention cleanup results (count deleted) to stdout

---

## Compatibility

### SPEC-018 Migration Note

When SPEC-018 (storage-schema) is approved, the Capture Pipeline's internal implementation changes as follows:

| Current | After SPEC-018 |
|---------|---------------|
| Direct `fs.mkdir`, `fs.writeFile`, `fs.readFile`, `fs.rmdir` calls | Delegated to storage abstraction from SPEC-018 |
| Capture directory layout defined inline | Layout validated against SPEC-018 schema |
| Path construction inline | Uses storage abstraction path methods |

The **public interface** remains **unchanged**:
- `persistCapture(packet, screenshots) → Result<StoredCapture>` — same signature
- `getCapture(captureId) → Result<StoredCapture>` — same signature
- `listCaptures(filter?) → Result<StoredCapture[]>` — same signature
- `exportCapture(captureId, exportPath) → Result<void>` — same signature
- `deleteCapture(captureId) → Result<void>` — same signature
- `getStorageStats() → Result<CaptureStorageStats>` — same signature
- `runRetentionCleanup(retentionDays) → Result<number>` — same signature

This is a purely internal migration. No consumer code requires changes.

### Breaking Change Policy

- Removing a method from the public API is a breaking change
- Changing a method signature (parameter types, return type) is a breaking change
- Changing the `StoredCapture` or `CaptureMetadata` schema in a way that removes or renames fields is a breaking change
- Adding new optional fields to `StoredCapture` or `CaptureMetadata` is **not** a breaking change
- Changing the storage layout (`metadata.json` location, screenshot file naming) is a breaking change — all existing captures must be migrated or become unreadable

### Deprecation Window

- Breaking changes require one minor version deprecation window before the old behavior is removed
- During the deprecation window, both old and new behavior must be supported
- Migration path must be documented for each breaking change

---

## Testing Requirements

### Unit Tests

| ID | Test | Scope | Expected Result |
|----|------|-------|----------------|
| UT-01 | `persistCapture` writes files to a temp directory | Happy path | Capture directory created; `metadata.json` contains correct `CaptureMetadata`; all screenshot files exist with correct sizes |
| UT-02 | `persistCapture` with 3 screenshot types (viewport, selection, full-page) | Happy path | All 3 files written; metadata records all 3 entries with correct types, dimensions, and relative paths |
| UT-03 | `persistCapture` rejects when available disk space < 50 MB | Storage full | Returns `CP_STORAGE_FULL`; no directory created |
| UT-04 | `persistCapture` with invalid captureId | Input validation | Returns `CP_INVALID_CAPTURE_ID`; no filesystem access |
| UT-05 | `persistCapture` cleans up partial files on write failure | Failure recovery | Simulate write failure mid-way; verify no files remain; directory removed |
| UT-06 | `persistCapture` with empty screenshots array | Input validation | Returns `CP_NO_SCREENSHOTS`; no directory created |
| UT-07 | `getCapture` retrieves a previously persisted capture | Happy path | Returns `StoredCapture` matching the data passed to `persistCapture` |
| UT-08 | `getCapture` for non-existent captureId | Not found | Returns `CP_CAPTURE_NOT_FOUND` |
| UT-09 | `getCapture` for malformed captureId | Input validation | Returns `CP_INVALID_CAPTURE_ID` |
| UT-10 | `getCapture` for corrupt `metadata.json` | Metadata corrupt | Returns `CP_METADATA_CORRUPT` with path in error metadata |
| UT-11 | `listCaptures` returns all captures when no filter provided | Happy path | Returns array of all persisted `StoredCapture` records sorted by timestamp descending |
| UT-12 | `listCaptures` respects `limit` and `offset` | Pagination | Returns exactly `limit` records starting from `offset` |
| UT-13 | `listCaptures` filters by `fromDate` and `toDate` | Date filter | Returns only captures within the date range (inclusive) |
| UT-14 | `listCaptures` filters by `pageUrl` | URL filter | Returns only captures whose page URL contains the filter string (case-insensitive) |
| UT-15 | `listCaptures` filters by `tags` | Tag filter | Returns only captures with any matching tag (OR semantics) |
| UT-16 | `deleteCapture` removes directory and all files | Happy path | `.viskod/captures/{captureId}/` no longer exists; subsequent `getCapture` returns `CP_CAPTURE_NOT_FOUND` |
| UT-17 | `deleteCapture` for non-existent capture | Error | Returns `CP_CAPTURE_NOT_FOUND` |
| UT-18 | `runRetentionCleanup` deletes only old captures | Retention policy | Create 5 captures with varying timestamps; run cleanup with appropriate retention; verify only old captures deleted |
| UT-19 | `runRetentionCleanup` preserves most recent capture | Safety guarantee | Even when the most recent capture is older than retentionDays, it is not deleted |
| UT-20 | `runRetentionCleanup` with negative retentionDays | Input validation | Returns `CP_RETENTION_INVALID` |
| UT-21 | `runRetentionCleanup` with zero captures | Edge case | Returns count = 0; no error |
| UT-22 | `runRetentionCleanup` with retentionDays = 0 | Edge case | Deletes all captures except the most recent one |
| UT-23 | `exportCapture` copies all files to export path | Happy path | Export path contains all screenshot files and `metadata.json`; source capture directory unchanged |
| UT-24 | `exportCapture` for non-existent capture | Error | Returns `CP_CAPTURE_NOT_FOUND` |
| UT-25 | `exportCapture` to non-existent directory | Error | Returns `CP_EXPORT_FAILED` |
| UT-26 | `getStorageStats` returns correct statistics | Happy path | `totalCaptures`, `totalSizeBytes`, and date range match expected values from persisted captures |
| UT-27 | `getStorageStats` with zero captures | Edge case | `totalCaptures = 0`, `totalSizeBytes = 0`, dates may be null or epoch |
| UT-28 | All screenshot paths in `metadata.json` are relative | Contract | No path starts with `/`, `C:\`, or contains `..` |

### Integration Tests

| ID | Test | Scope | Expected Result |
|----|------|-------|----------------|
| IT-01 | VCE calls `persistCapture` → CP persists → verify on disk | End-to-end capture flow | Screenshots readable; `metadata.json` validates against `CaptureMetadata` schema |
| IT-02 | `StoredCapture` structure from `getCapture` matches what `persistCapture` returned | Roundtrip consistency | All fields identical; no data degradation |
| IT-03 | Retention cleanup with 100 captures of mixed ages | Retention at scale | Only captures older than retentionDays deleted; most recent preserved; operation completes within performance budget |

### Contract Tests

| ID | Test | Scope | Expected Result |
|----|------|-------|----------------|
| CT-01 | `StoredCapture` schema matches SPEC-006 `ContextPacket` fields | Cross-spec alignment | `captureId`, `packetId`, `timestamp`, `page.url`, `page.viewport` hold equivalent data |
| CT-02 | `Screenshot` input type from BR matches CP's expected input | Cross-subsystem alignment | BR-produced screenshots satisfy CP's `Screenshot` interface |
| CT-03 | `CaptureMetadata` schema validates against defined interface | Schema integrity | All required fields present; all screenshots entries have correct types |
| CT-04 | Zero imports from `browser-runtime` in capture pipeline source | Architecture compliance | `grep` on capture-pipeline source returns zero matches for `browser-runtime` |
| CT-05 | Zero imports from `visual-context-engine` in capture pipeline source | Architecture compliance | `grep` on capture-pipeline source returns zero matches for `visual-context-engine` |

### End-to-End Acceptance Criteria

| ID | Criteria |
|----|----------|
| E2E-01 | Full capture flow: BR takes screenshot → VCE creates packet → CP persists → verify `.viskod/captures/{id}/` directory structure correct |
| E2E-02 | Full capture flow: screenshots are readable images after persistence (not corrupted buffers) |
| E2E-03 | Capture retrieval returns identical structure to what was persisted (roundtrip fidelity) |
| E2E-04 | Capture deletion removes all files; subsequent retrieval returns not found |
| E2E-05 | Storage full detection rejects new captures when disk drops below threshold |

---

## Acceptance Criteria

Before this specification can move to Approved:

- [ ] `persistCapture` creates the correct `.viskod/captures/{captureId}/` directory structure for every invocation
- [ ] `metadata.json` schema validates against the `CaptureMetadata` interface — all required fields present, all paths relative
- [ ] Screenshots are written and readable after `persistCapture` — no corrupted buffers, no truncated files
- [ ] `getCapture` returns an identical `StoredCapture` structure to what was returned by `persistCapture`
- [ ] `deleteCapture` removes all files for the capture — no orphaned files or empty directories left behind
- [ ] `runRetentionCleanup` respects the `retentionDays` parameter — only captures older than the threshold are deleted
- [ ] `runRetentionCleanup` preserves the most recent capture regardless of age
- [ ] Storage full detection works — rejects new captures when available disk space drops below 50 MB
- [ ] No browser logic in any function — verify: zero imports from `browser-runtime`, zero imports from `playwright`, zero DOM API usage
- [ ] No analysis logic in any function — verify: zero imports from `visual-context-engine`, zero imports from `source-hint-engine`
- [ ] All paths are relative — no absolute paths in `metadata.json`, no path traversal beyond `.viskod/captures/`
- [ ] Buffer writes are atomic — no partial files remain on `persistCapture` failure; all artifacts cleaned up before error return
- [ ] All public API methods return `Result<T, E>` — consistent with SPEC-002 utility types
- [ ] All error codes are from the `CP_` namespace — no generic error codes used
- [ ] All error objects conform to `ViskodError` from SPEC-002
- [ ] Input validation occurs before any filesystem operation — `captureId` format, `retentionDays` range, `exportPath` writability
- [ ] All unit tests (UT-01 through UT-28) pass
- [ ] All integration tests (IT-01 through IT-03) pass
- [ ] All contract tests (CT-01 through CT-05) pass
- [ ] Performance budgets confirmed — `persistCapture` < 200 ms, `getCapture` < 10 ms, `deleteCapture` < 50 ms
- [ ] No logged data contains absolute filesystem paths outside `.viskod/`
- [ ] No logged data contains screenshot file contents or metadata tag values

---

## Open Implementation Decisions

None. The Capture Pipeline storage layout and behavior are fully defined by this specification and the architecture documents.

The only deferred decision is the migration to SPEC-018 (storage-schema) for the underlying filesystem abstraction. This is documented as a compatibility note in §Compatibility. The migration is internal-only and does not affect the public API.

---

## Migration Considerations

This is the initial specification. No migration from a prior version is required.

### Future Migration: SPEC-018

When SPEC-018 (storage-schema) is approved:
1. Replace direct `fs/path` operations with storage abstraction calls
2. Validate existing capture storage layout against SPEC-018 schema
3. If layout differs, provide migration script: `viskod migrate captures`
4. Public API remains unchanged — migration is transparent to consumers
5. Decision record created in `/decisions/` documenting the migration

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Disk I/O variance causes performance budget misses | Medium | Low | Budgets are targets on developer-class hardware (NVMe SSD); HDD variance is acceptable and budgets will be recalibrated if needed |
| Capture directory accumulates excessive files without cleanup | Medium | Medium | `runRetentionCleanup` is a public API method; CLI and Studio must invoke it. Responsibility for scheduling cleanup is deferred to the caller (not the pipeline's concern). |
| UUID v4 collision with existing capture directories | Extremely Low | Low | UUID v4 collision probability is negligible (~2^122 possible values). Collision detection at directory creation time provides defense-in-depth. |
| SPEC-018 incompatibility forces breaking API changes | Low | Medium | This specification defines the public API as stable. SPEC-018's storage abstraction must conform to this API, not the reverse. This is noted in the migration compatibility clause. |
| Screenshot buffers exceed available memory during persist | Low | Medium | Screenshots are streamed by Browser Runtime and written incrementally. In-memory buffer for a single capture is bounded by total screenshot data from one capture event (typically < 10 MB). |

---

## Implementation Sequence

1. Create package directory `packages/capture-pipeline/` per SPEC-001 conventions
2. Initialise `packages/capture-pipeline/package.json` with `@viskod/capture-pipeline` name, TypeScript strict mode, dependencies: `@viskod/shared`, `@viskod/error-model`, Node.js built-in `fs/path`
3. Implement `src/types.ts` — `Screenshot`, `StoredCapture`, `CaptureFilter`, `CaptureStorageStats`, `CaptureMetadata` interfaces
4. Implement `src/validation.ts` — `validateCaptureId`, `validateScreenshots`, `validateRetentionDays`, `validateExportPath`
5. Implement `src/storage-check.ts` — `checkAvailableSpace` against threshold
6. Implement `src/atomic-write.ts` — `writeAtomic` utility (write to temp file, rename)
7. Implement `src/persist.ts` — `persistCapture` command flow
8. Implement `src/retrieve.ts` — `getCapture` and `listCaptures` command flows
9. Implement `src/export.ts` — `exportCapture` command flow
10. Implement `src/delete.ts` — `deleteCapture` and `runRetentionCleanup` command flows
11. Implement `src/stats.ts` — `getStorageStats` command flow
12. Implement `src/index.ts` — barrel re-exports; `createCapturePipeline()` factory function
13. Write unit tests (UT-01 through UT-28)
14. Write integration tests (IT-01 through IT-03)
15. Write contract tests (CT-01 through CT-05)
16. Run `tsc --noEmit --strict` and fix any errors
17. Run lint and fix any violations
18. Run all tests and verify they pass
19. Verify performance budgets with benchmarks
20. Update `docs/capture-pipeline.md` if this specification diverges (doc is authoritative until spec is Approved)

---

## Definition of Done

- [ ] `packages/capture-pipeline/` directory exists with correct structure per SPEC-001
- [ ] All TypeScript interfaces (`Screenshot`, `StoredCapture`, `CaptureFilter`, `CaptureStorageStats`, `CaptureMetadata`) defined and exported
- [ ] `persistCapture` implemented with atomic write guarantees
- [ ] `getCapture` implemented with UUID validation and corruption detection
- [ ] `listCaptures` implemented with filtering and pagination
- [ ] `exportCapture` implemented with path validation and file copy
- [ ] `deleteCapture` implemented with recursive directory removal
- [ ] `getStorageStats` implemented with directory enumeration and size aggregation
- [ ] `runRetentionCleanup` implemented with age-based deletion and most-recent-capture preservation
- [ ] Storage full detection rejects captures below threshold
- [ ] All errors use `CP_` namespace and conform to `ViskodError`
- [ ] Input validation occurs before all filesystem operations
- [ ] Zero imports from `browser-runtime`
- [ ] Zero imports from `visual-context-engine`
- [ ] Zero imports from `playwright`
- [ ] All paths in `metadata.json` are relative
- [ ] All 28 unit tests pass
- [ ] All 3 integration tests pass
- [ ] All 5 contract tests pass
- [ ] TypeScript strict mode compiles without errors
- [ ] Lint passes
- [ ] Performance budgets confirmed with benchmarks
- [ ] No absolute filesystem paths in logs
- [ ] Specification status updated from Draft to Approved
- [ ] Architecture sources remain consistent (no drift between this spec and `docs/capture-pipeline.md`)
