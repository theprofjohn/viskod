# Event Bus

> **Specification ID:** SPEC-007
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Platform Architecture
> **Priority:** P0
> **Last Updated:** 2026-07-28

---

## Architecture Sources

* `docs/architecture.md` §Event Bus — Event Bus as integration boundary; transports immutable facts between subsystems; owns no business logic, makes no decisions, never initiates actions
* `docs/architecture.md` §Internal Events — packages communicate through typed events; events are immutable
* `docs/architecture.md` §Runtime Boundary — Browser Runtime communicates only with Chromium and VCE (via VCE's public API); Browser Runtime emits events to Event Bus; VCE subscribes to BR events exclusively through Event Bus; no direct callbacks, no imported BR modules, no bypass of event infrastructure
* `docs/architecture.md` §Dependency Rules — dependencies always point inward; never reverse dependency direction; reverse communication from BR to VCE occurs ONLY through Event Bus
* `docs/architecture.md` §State Synchronisation — Studio must never query browser directly; Browser Runtime → Event Bus → State Store → Studio/VCE; one direction; no circular communication
* `docs/events.md` — full event system specification; design philosophy: events describe what has happened, not what should happen; event lifecycle: Created → Validated → Published → Delivered → Processed → Archived; architecture: Platform Service → Event Publisher → Event Bus → Subscribers → Platform Services; publishers must not know which subscribers consume their events
* `docs/events.md` §Error Handling — isolate failing subscriber; preserve publisher execution; emit diagnostics; support retry where appropriate; one failing subscriber must never interrupt event distribution
* `docs/events.md` §Performance Targets — event publication < 2 ms; subscriber dispatch < 5 ms; event validation < 2 ms
* `docs/events.md` §Security — events must never expose secrets, credentials, authentication tokens, private configuration, sensitive user information; security policies apply equally to internal and public events
* `docs/ARCHITECTURE_BASELINE.md` §Asynchronous Event Flow — Browser Runtime → Event Bus → VCE represents asynchronous event flow; BR publishes browser lifecycle, navigation, DOM, capture, selection and state-change events to Event Bus; VCE subscribes through Event Bus; BR never knows which subscribers consume its events
* `docs/ARCHITECTURE_BASELINE.md` §Prohibited Dependencies — BR must not directly call VCE methods; BR must not import VCE implementation modules; VCE must not receive browser events through direct callbacks that bypass Event Bus; Event Bus is an integration boundary that owns transport and delivery, not business logic; command dependency and event flow are distinct communication patterns; no bi-directional dependency exists except through Event Bus
* `docs/glossary.md` §Event Bus — the platform's integration boundary for asynchronous, publish-subscribe communication between subsystems; transports immutable events from publishers to subscribers; owns no business logic, makes no decisions, never initiates actions; publishers emit events without knowing which subscribers consume them; subscribers register interest in specific event types; does not replace command-style service invocation

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Draft | Imports `BaseEvent<T, P>`, `Identifier`, `Timestamp`, `Version`, `ViskodError`, `Result<T, E>`, and Zod schema utilities for event validation |
| SPEC-003 (error-model) | Draft | Imports `ErrorCategory`, `ErrorSeverity`, `ViskodError` for structuring delivery and validation failures |
| SPEC-005 (event-schema) | Draft | Consumes `ViskodEvent` discriminated union and `ViskodEventSchema` for runtime event validation; uses event type string constants for subscription matching |

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-008 (browser-runtime) | Draft | Publishes events to the Event Bus — Browser Lifecycle, Viewport and Selection, Capture events |
| SPEC-009 (visual-context-engine) | Draft | Subscribes to Browser Runtime events through the Event Bus; never receives browser events through direct callbacks |
| Selection Engine | Draft | Publishes selection events; subscribes to viewport and browser lifecycle events |
| Diagnostics | Draft | Publishes diagnostics events; subscribes to error and health events |
| Plugin System | Planned | Publishes plugin lifecycle events; subscribes to platform events |
| Studio | Draft | Subscribes to state-change events for UI updates; never queries browser directly |

---

## Purpose

Defines the Event Bus: the platform's integration boundary for asynchronous, publish-subscribe communication between Viskod subsystems. The Event Bus owns transport and delivery of immutable events. It owns no business logic, makes no decisions, initiates no actions, and maintains no state beyond delivery queues. The Event Bus enforces the architectural rule that reverse communication from Browser Runtime to Visual Context Engine occurs exclusively through this infrastructure.

---

## Scope

* Publish, subscribe, and unsubscribe APIs with typed event validation
* Delivery fan-out to all matching subscribers with isolation guarantees
* Subscriber error isolation per configurable error strategy
* Queue overflow protection (drop-oldest policy)
* Optional event history buffer for late subscribers
* Lifecycle management (Created → Active → Draining → Stopped)
* Diagnostic interface exposing publication, delivery, and subscription metrics
* Immutability enforcement: events frozen after publication
* Publisher-subscriber anonymity: publisher identity never exposed to subscribers; subscriber identity never exposed to publishers
* Integration-boundary enforcement: no business logic, no decision-making, no initiated actions
* Correlation ID propagation without inspection

---

## Non-Goals

* Event persistence, archival, or replay beyond the optional history buffer — deferred to SPEC-010 (storage-model)
* Event ordering guarantees beyond delivery FIFO within the queue — no causal ordering, no global event ordering
* Distributed or cross-process event transport — Phase 1 is in-process pub-sub; IPC transport decisions deferred to DEC-004
* Event schema definition — owned by SPEC-005 (event-schema)
* Business logic triggered by events — each subscriber owns its own reaction
* Event transformation, enrichment, or filtering beyond the `SubscribeOptions.filter` predicate
* Dead-letter queuing, retry with backoff, or persistent retry policies
* Plugin-defined event types or dynamic event registration — deferred to SPEC-015 (plugin-system)
* Event metrics export, tracing integration, or telemetry — owned by SPEC-021 (observability)

---

## Terminology

Terms specific to this specification. Reference `docs/glossary.md` for all canonical terms.

| Term | Definition |
|------|-----------|
| Publisher | Any subsystem that calls `eventBus.publish(event)` with a validated `ViskodEvent`. Publishers never know which subscribers receive their events. The primary publisher in Phase 1 is the Browser Runtime. |
| Subscriber | Any subsystem that calls `eventBus.subscribe(eventType, handler)` to register interest in one or more event types. Subscribers receive immutable event snapshots and process them independently. Subscribers never know the publisher's identity beyond the `source` field. |
| Handler | The callback function registered by a subscriber. Handlers receive a typed `ViskodEvent` and may be synchronous or asynchronous. Handler execution is isolated per subscriber. |
| Subscription | An active registration binding a subscriber to an event type. Each subscription has a unique ID, an event type, an optional filter predicate, a priority for delivery ordering, and a `once` flag for auto-unsubscribe. |
| Delivery | The act of invoking a subscriber's handler with a valid event. Delivery is non-blocking fan-out: each subscriber is called independently. A failing subscriber does not block delivery to other subscribers. |
| Fan-out | The dispatch of a single published event to all subscribers registered for that event type. Fan-out is unordered across subscribers except where priority ordering applies. |
| Error strategy | Configurable behaviour when a subscriber handler throws or times out: `"continue"` (log and continue delivering to other subscribers) or `"pause-subscriber"` (suspend the failing subscriber until manually resumed). |
| Queue | An internal ordered buffer of events awaiting delivery. Events are dequeued in FIFO order. When the queue exceeds `maxQueueSize`, the oldest event is dropped. |
| History buffer | An optional circular buffer retaining the last N delivered events. Late subscribers requesting history receive these events immediately upon subscribing. |
| Drain | The process of completing all in-flight deliveries before stopping. During draining, no new publications or subscriptions are accepted. |
| Correlation ID | A UUID v4 linking related events in a causal chain. The Event Bus propagates correlation IDs without inspecting or logging their values beyond delivery tracking. |

---

## Runtime Boundary

| Boundary | Responsibility |
|----------|---------------|
| Process | In-process pub-sub within the Viskod Node.js process. No network transport, no IPC, no external broker. |
| Owns | Subscription registry, event delivery queues, handler invocation, timeout enforcement, error isolation, lifecycle state, diagnostic counters, optional history buffer |
| Forbidden | Business logic of any kind; decisions about event content; initiation of communication not triggered by publish/subscribe/unsubscribe calls; modification of event payloads; disclosure of publisher identity to subscribers; disclosure of subscriber identity to publishers; persistence of events beyond the optional history buffer; network access; file system access; DOM access; browser APIs |

---

## Responsibilities

1. **Accept published events** via `publish(event)` and validate every event against `ViskodEventSchema` before queuing
2. **Deliver events** to all matching subscribers via non-blocking fan-out with per-subscriber timeout enforcement
3. **Isolate subscriber failures** so one failing handler never blocks delivery to other subscribers
4. **Enforce delivery timeout** per the configured `deliveryTimeout`, applying the configured `errorStrategy`
5. **Manage queue overflow** by dropping the oldest event when `maxQueueSize` is exceeded, emitting a diagnostic counter increment
6. **Support subscription filtering** via optional `filter` predicate on `SubscribeOptions`
7. **Support priority-ordered delivery** via optional `priority` field on subscriptions (higher priority = earlier delivery)
8. **Support one-shot subscriptions** via `once: true` in `SubscribeOptions`, auto-unsubscribing after first delivery
9. **Manage lifecycle** through explicit state transitions: Created → Active → Draining → Stopped
10. **Expose diagnostic interface** (`EventBusDiagnostics`) with counters for published, delivered, failed, active subscriptions, queue size, and per-subscriber stats
11. **Enforce publisher-subscriber anonymity** — no API exposes publisher identity to subscribers or subscriber identity to publishers
12. **Propagate correlation IDs** without inspecting, logging, or exposing their values
13. **Log subscribe/unsubscribe operations and delivery failures** at appropriate log levels
14. **Support optional event history** via `enableHistory` and `historySize` configuration, replaying history to late subscribers
15. **Contain zero business logic** — the Event Bus transports facts; it never interprets, transforms, or acts upon event content
16. **Never initiate actions** — all work is triggered by external calls to `publish`, `subscribe`, or `unsubscribe`
17. **Return `Result<void>`** from all public APIs, conforming to the error model from SPEC-003

---

## Interfaces

### Public API

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|
| `eventBus.publish<T extends ViskodEvent>(event: T): Result<void>` | Accept a validated event, queue it, and deliver to all matching subscribers | Event Bus is in Active state; event conforms to `ViskodEvent` type | Event validated, queued, and delivered to all matching subscribers; diagnostic counters updated | `EB_PUBLISH_INVALID` if event fails Zod validation; `EB_BUS_STOPPED` if not in Active state; `EB_QUEUE_FULL` if maxQueueSize exceeded (event may still be queued after dropping oldest) |
| `eventBus.subscribe<T extends ViskodEvent['eventType']>(eventType: T, handler: EventHandler<T>, options?: SubscribeOptions): Result<Subscription>` | Register a handler for a specific event type | Event Bus is in Active state; `eventType` is a valid member of `ViskodEvent['eventType']`; `handler` is a function accepting the typed event | Subscription registered with unique ID; handler will be invoked for every matching published event; late subscriber receives history if enabled | `EB_SUBSCRIBE_INVALID_TYPE` if `eventType` is not in the `ViskodEvent` union; `EB_BUS_STOPPED` if not in Active state |
| `eventBus.unsubscribe(subscriptionId: string): Result<void>` | Remove a previously registered subscription | Event Bus is in Active or Draining state; `subscriptionId` was returned by a prior `subscribe` call | Subscription removed; handler will no longer receive events; if subscription does not exist, returns success (idempotent) | `EB_BUS_STOPPED` if in Stopped state |

### Event Handler Type

```typescript
type EventHandler<T extends ViskodEvent['eventType']> = (
  event: Extract<ViskodEvent, { eventType: T }>
) => Promise<void> | void;
```

Handlers may be synchronous or asynchronous. If a handler returns a Promise, the Event Bus awaits it with the configured `deliveryTimeout`. If the handler throws or the promise rejects, the error is handled per the configured `errorStrategy`.

### SubscribeOptions

```typescript
interface SubscribeOptions {
  filter?: (event: ViskodEvent) => boolean;
  priority?: number;  // higher = earlier delivery, default 0
  once?: boolean;     // auto-unsubscribe after first delivery, default false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `filter` | `(event: ViskodEvent) => boolean` | `undefined` (no filter; all events of matching type delivered) | Optional predicate. Called before handler invocation. If it returns `false`, the handler is not invoked for that event. Must be synchronous. |
| `priority` | `number` | `0` | Delivery ordering within the same event type. Higher values are delivered earlier. Subscribers with equal priority are delivered in registration order. |
| `once` | `boolean` | `false` | If `true`, the subscription is automatically removed after the handler is invoked once (successfully or not). |

### Subscription

```typescript
interface Subscription {
  id: string;
  eventType: string;
  createdAt: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID v4, uniquely identifying this subscription |
| `eventType` | `string` | The event type string this subscription matches |
| `createdAt` | `string` | ISO 8601 timestamp of when the subscription was created |

### EventBusFactory

```typescript
interface EventBusFactory {
  create(options?: EventBusOptions): EventBus;
}
```

The factory is the single entry point for creating Event Bus instances. The factory returns an Event Bus in the `Created` state. The caller must call a `start()` method (or equivalent) to transition to `Active`.

### EventBusOptions

```typescript
interface EventBusOptions {
  maxQueueSize?: number;        // default: 10000
  deliveryTimeout?: number;     // ms, default: 5000
  errorStrategy?: 'continue' | 'pause-subscriber';  // default: 'continue'
  enableHistory?: boolean;      // default: false
  historySize?: number;         // default: 100
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxQueueSize` | `number` | `10000` | Maximum number of undelivered events in the queue. When exceeded, the oldest event is dropped and the `EB_QUEUE_FULL` diagnostic is emitted. Must be ≥ 1. |
| `deliveryTimeout` | `number` | `5000` | Maximum time in milliseconds a subscriber handler may execute before being considered timed out. If a handler exceeds this, the timeout error is handled per `errorStrategy`. Must be ≥ 1. |
| `errorStrategy` | `'continue' \| 'pause-subscriber'` | `'continue'` | `'continue'`: log the error and continue delivering to other subscribers. `'pause-subscriber'`: log the error, suspend the failing subscriber (no further deliveries until manually resumed), and continue delivering to other subscribers. |
| `enableHistory` | `boolean` | `false` | If `true`, the Event Bus retains the last `historySize` delivered events in a circular buffer. Late subscribers receive these events immediately upon subscribing. |
| `historySize` | `number` | `100` | Number of events to retain in the history buffer when `enableHistory` is `true`. Must be ≥ 1. |

### Diagnostic Interface

```typescript
interface EventBusDiagnostics {
  totalPublished: number;
  totalDelivered: number;
  totalFailed: number;
  activeSubscriptions: number;
  queueSize: number;
  subscriberStats: Map<string, { delivered: number; failed: number; lastDeliveryMs: number }>;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalPublished` | `number` | Monotonically increasing counter of all events received via `publish()` |
| `totalDelivered` | `number` | Monotonically increasing counter of all successful handler invocations |
| `totalFailed` | `number` | Monotonically increasing counter of all handler invocations that threw, rejected, or timed out |
| `activeSubscriptions` | `number` | Current count of active (non-paused) subscriptions |
| `queueSize` | `number` | Current number of events in the delivery queue |
| `subscriberStats` | `Map<string, { delivered: number; failed: number; lastDeliveryMs: number }>` | Per-subscription statistics keyed by subscription ID. `lastDeliveryMs` is the timestamp (relative to Event Bus start) of the most recent delivery attempt. |

### Events Published

N/A — the Event Bus does not publish domain events. It is the transport layer for events published by other subsystems. The Event Bus may emit internal diagnostic counters but these are not part of the `ViskodEvent` catalogue.

### Events Subscribed

N/A — the Event Bus does not subscribe to events. It is the infrastructure through which other subsystems subscribe.

---

## Data Models

### ViskodEvent (imported from SPEC-005)

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

The Event Bus validates every published event against `ViskodEventSchema` (the discriminated union Zod schema from SPEC-005). The Event Bus does not construct, transform, or inspect event payloads beyond validation.

### Result<T, E> (imported from SPEC-002)

```typescript
type Result<T, E = ViskodError> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

All Event Bus public APIs return `Result<void>` (success) or `Result<void, ViskodError>` (failure).

### Internal Subscription Record

```typescript
interface SubscriptionRecord {
  id: string;                  // UUID v4
  eventType: string;           // ViskodEvent['eventType']
  handler: EventHandler<any>;  // The registered callback
  filter?: (event: ViskodEvent) => boolean;
  priority: number;
  once: boolean;
  createdAt: string;           // ISO 8601
  paused: boolean;             // true if paused due to errorStrategy='pause-subscriber'
  stats: {
    delivered: number;
    failed: number;
    lastDeliveryMs: number;
  };
}
```

`SubscriptionRecord` is an internal implementation type. The public API exposes only `Subscription`.

---

## State Model

```
Created ──start()──→ Active ──drain()──→ Draining ──→ Stopped
                       │                     │
                       │                     │
                       └──stop()─────────────┘
```

### State Transitions

| State | Description | Allowed Operations | Transition Triggers |
|-------|-------------|-------------------|---------------------|
| **Created** | Event Bus instantiated, not accepting events. Subscriptions may be pre-registered. | `subscribe`, `unsubscribe` | `start()` transitions to Active |
| **Active** | Fully operational. Accepting publish, subscribe, and unsubscribe calls. Events are queued and delivered. | `publish`, `subscribe`, `unsubscribe` | `drain()` transitions to Draining; `stop()` transitions directly to Stopped (abrupt, in-flight deliveries may be lost) |
| **Draining** | Stopping gracefully. Completing in-flight deliveries. No new publications or subscriptions accepted. Existing subscriptions may be removed. | `unsubscribe` | After all in-flight deliveries complete, transitions to Stopped |
| **Stopped** | No operations permitted. All resources released. All subscriptions removed. Queue flushed. History buffer cleared. | None | Terminal state. No further transitions. |

### State Invariants

1. The Event Bus cannot transition from Created to Active without an explicit `start()` call
2. `publish` is only valid in Active state
3. `subscribe` is only valid in Active state (or Created with pre-registration)
4. `unsubscribe` is valid in Created, Active, and Draining states
5. No operation is valid in Stopped state
6. During Draining, in-flight handler promises are awaited; no new events are accepted
7. Transition to Stopped (whether from Active via stop() or from Draining after drain()) clears all subscriptions, the queue, and the history buffer
8. The Event Bus cannot transition from Stopped back to any earlier state; a new instance must be created

---

## Command Flows

### Publish

```
Publisher
  │
  │  calls eventBus.publish(event)
  │
  ▼
──calls──→ EventBus.publish()
              │
              │  validate event against ViskodEventSchema
              │  ── on validation failure: return Result { ok: false, error: EB_PUBLISH_INVALID }
              │
              │  check queue capacity
              │  ── if queue is full: drop oldest event, emit diagnostic, continue
              │
              │  enqueue validated event
              │
              │  increment totalPublished counter
              │
              │  deliver to matching subscribers (see Delivery Flow below)
              │
              │  return Result { ok: true, value: void }
              ▼
         Result<void>

Delivery per subscriber (synchronous within fan-out, non-blocking across subscribers):
  │
  │  for each subscriber matching eventType:
  │    │
  │    │  if subscriber.filter exists and returns false → skip
  │    │
  │    │  call handler(event)
  │    │    │
  │    │    │  if handler returns Promise, await with deliveryTimeout
  │    │    │
  │    │    │  on success: increment subscriber stats (delivered, lastDeliveryMs); increment totalDelivered
  │    │    │
  │    │    │  on timeout (exceeds deliveryTimeout):
  │    │    │    ── log warning (EB_DELIVERY_TIMEOUT)
  │    │    │    ── increment subscriber stats (failed, lastDeliveryMs); increment totalFailed
  │    │    │    ── if errorStrategy = 'continue': continue to next subscriber
  │    │    │    ── if errorStrategy = 'pause-subscriber': set subscriber.paused = true, continue to next subscriber
  │    │    │
  │    │    │  on handler throw/rejection:
  │    │    │    ── log error (EB_DELIVERY_FAILED)
  │    │    │    ── increment subscriber stats (failed, lastDeliveryMs); increment totalFailed
  │    │    │    ── if errorStrategy = 'continue': continue to next subscriber
  │    │    │    ── if errorStrategy = 'pause-subscriber': set subscriber.paused = true, continue to next subscriber
  │    │
  │    │  if subscriber.once = true → auto-unsubscribe after first delivery (success or failure)
  │
  │  (delivery order: sorted by subscriber.priority descending, then by registration order)
```

**Critical architectural constraints on delivery:**
- Delivery is non-blocking fan-out: no single subscriber's execution blocks another
- The Event Bus does not await subscriber handler results before delivering to the next subscriber
- A timeout on subscriber A does not delay delivery to subscriber B
- A thrown error by subscriber A does not prevent delivery to subscriber B
- The publisher receives `Result { ok: true }` before all subscribers have completed processing (fire-and-forget to subscribers)

### Subscribe

```
Subscriber
  │
  │  calls eventBus.subscribe(eventType, handler, options?)
  │
  ▼
──calls──→ EventBus.subscribe()
              │
              │  validate eventType against ViskodEvent discriminated union members
              │  ── if not a valid event type: return Result { ok: false, error: EB_SUBSCRIBE_INVALID_TYPE }
              │
              │  generate subscription ID (UUID v4)
              │
              │  create SubscriptionRecord with handler, filter, priority, once, createdAt
              │
              │  register in subscription registry for eventType
              │
              │  if enableHistory = true:
              │    │
              │    │  replay history buffer events matching eventType to the new subscriber
              │    │  (history replay occurs synchronously before subscribe returns)
              │
              │  log subscribe operation
              │
              │  return Result { ok: true, value: Subscription { id, eventType, createdAt } }
              ▼
         Result<Subscription>
```

### Unsubscribe

```
Subscriber
  │
  │  calls eventBus.unsubscribe(subscriptionId)
  │
  ▼
──calls──→ EventBus.unsubscribe()
              │
              │  look up subscriptionId in registry
              │  ── if not found: return Result { ok: true, value: void } (idempotent)
              │
              │  remove subscription from registry
              │
              │  log unsubscribe operation
              │
              │  return Result { ok: true, value: void }
              ▼
         Result<void>
```

---

## Event Flows

### Asynchronous Delivery

```
Publisher (e.g., Browser Runtime)
  │
  │  eventBus.publish(event)
  │
  ▼
──publish──→ Event Bus
                │
                │  validate event
                │  enqueue event
                │
                │  ──deliver──→ Subscriber A (handler called)
                │  ──deliver──→ Subscriber B (handler called)
                │  ──deliver──→ Subscriber C (handler called)
                │
                │  (subscribers never know publisher identity)
                │  (subscribers execute independently)
                ▼
            Result<void> returned to publisher
```

### Late Subscriber with History

```
Subscriber (late registration)
  │
  │  eventBus.subscribe(eventType, handler)
  │
  ▼
──subscribe──→ Event Bus (enableHistory = true)
                  │
                  │  register subscription
                  │
                  │  replay history buffer:
                  │    for each historical event matching eventType:
                  │      ──deliver──→ new Subscriber (handler called with historical event)
                  │
                  │  return Subscription
                  ▼
              Result<Subscription>
```

### Subscriber Error Isolation

```
Publisher ──publish──→ Event Bus
                          │
                          ├──deliver──→ Subscriber A ✓ (success)
                          ├──deliver──→ Subscriber B ✗ (throws)
                          │               │
                          │               ├── log EB_DELIVERY_FAILED
                          │               ├── increment totalFailed
                          │               └── if errorStrategy = 'pause-subscriber': pause Subscriber B
                          │
                          └──deliver──→ Subscriber C ✓ (success, unaffected by B's failure)
```

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Event fails `ViskodEventSchema` validation (unknown `eventType`, missing required field, wrong payload shape, non-UUID `eventId`, etc.) | `EB_PUBLISH_INVALID` | `"Event does not match schema for event type '<eventType>': <ZodError details>"` | Event rejected; not queued; not delivered. Error logged. Publisher must construct a valid event and retry. |
| Event `eventType` string is not a recognized member of the `ViskodEvent` union | `EB_PUBLISH_INVALID` | `"Unknown event type '<eventType>'. Expected one of: <canonical event type list>"` | Event rejected; not queued; not delivered. Error logged. Publisher must use a canonical event type string. |
| `subscribe` called with an `eventType` string not present in the `ViskodEvent` union | `EB_SUBSCRIBE_INVALID_TYPE` | `"Invalid event type '<eventType>'. Must be a member of the ViskodEvent union."` | Subscription rejected; not registered. Subscriber must use a canonical event type string constant from SPEC-005. |
| Subscriber handler exceeds `deliveryTimeout` (default: 5000 ms) | `EB_DELIVERY_TIMEOUT` | `"Subscriber <subscriptionId> handler for event type '<eventType>' exceeded delivery timeout of <timeout>ms."` | Warning logged. If `errorStrategy = 'continue'`: delivery to other subscribers continues. If `errorStrategy = 'pause-subscriber'`: failing subscriber paused; other subscribers continue. Total failed counter incremented. |
| Subscriber handler throws or rejects | `EB_DELIVERY_FAILED` | `"Subscriber <subscriptionId> handler for event type '<eventType>' failed: <error.message>"` | Error logged. If `errorStrategy = 'continue'`: delivery to other subscribers continues. If `errorStrategy = 'pause-subscriber'`: failing subscriber paused; other subscribers continue. Total failed counter incremented. |
| Queue exceeds `maxQueueSize` (default: 10000) during `publish` | `EB_QUEUE_FULL` | `"Event bus queue reached maximum size of <maxQueueSize>. Dropping oldest undelivered event."` | Diagnostic counter incremented. Oldest event dropped from queue. New event enqueued. Operation continues. No error returned to publisher for publisher's own event; the dropped event is previously queued. |
| Any operation (`publish`, `subscribe`, `unsubscribe`) called after `stop()` or during `Draining` (for `publish`/`subscribe`) | `EB_BUS_STOPPED` | `"Event bus is not in Active state. Current state: <state>. Requested operation: <operation>."` | Operation rejected. Caller must check state or await a new Event Bus instance. |
| `unsubscribe` called with a subscription ID that does not exist | None (success) | N/A | Idempotent: returns `Result { ok: true, value: void }`. No error. |

All error codes are prefixed with `EB_` (Event Bus) and conform to the error model defined in SPEC-003. Errors are returned as `Result<T, ViskodError>` from public API methods.

---

## Security Requirements

* **Every event validated before delivery:** The Event Bus must call `ViskodEventSchema.parse(event)` on every published event before it enters the queue. Events that fail validation are rejected and never delivered to any subscriber.
* **Subscriber handlers never receive raw, untyped data:** All events delivered to subscribers have passed Zod validation. Subscriber handlers receive typed `ViskodEvent` objects, never `unknown` or `any`.
* **No cross-subscriber data leakage:** Each subscriber receives its own reference to the event. Subscribers cannot modify each other's event references (events are frozen after publication). Internal Event Bus state (subscription records, subscriber stats) is never exposed to subscribers.
* **Publisher identity never exposed to subscribers:** The `source` field on events identifies the emitting subsystem (e.g., `"browser-runtime"`), not the publisher instance. No API exposes which publisher called `publish()`.
* **Subscriber identity never exposed to publishers:** The `publish()` method returns `Result<void>`. Publishers receive no information about which subscribers received the event, how many handlers were invoked, or what their subscription IDs are.
* **No event modification after publication:** Events are frozen (via `Object.freeze` or equivalent) after validation. Subscriber handlers receive immutable snapshots.
* **No secrets in diagnostic output:** Diagnostic counters (`totalPublished`, `totalDelivered`, `totalFailed`, `subscriberStats`) contain numeric aggregates only. Event payloads, correlation IDs, and subscription handler references are never exposed through the diagnostic interface.
* **Correlation IDs are opaque strings:** The Event Bus propagates correlation IDs without inspecting their values. The Event Bus never deduplicates by correlation ID, orders by correlation ID, or logs correlation ID values at any level.

---

## Privacy Requirements

* **No persistent event log by default:** `enableHistory` defaults to `false`. Without explicit opt-in, the Event Bus retains no record of events after delivery.
* **`enableHistory` must be explicitly requested:** The Event Bus does not enable history unless the `EventBusOptions.enableHistory` flag is set to `true` at creation time.
* **History buffer must be purgeable:** The implementation must support clearing the history buffer (e.g., via `EventBusDiagnostics` or a dedicated clear method).
* **Correlation IDs are opaque UUIDs:** Correlation IDs are UUID v4 values that encode no information about the developer, project, machine, or environment.
* **No PII in diagnostic output:** All diagnostic counters are numeric aggregates. No event payload data, subscriber identity, or publisher identity is exposed through diagnostics.
* **No event content is logged:** Log messages for subscribe, unsubscribe, and delivery failure contain subscription IDs and event types, not event payloads or field values.

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| `publish()` latency (excluding subscriber handler time) | < 2 ms p95 | `performance.now()` wrap around `publish(event)` call; measure validation + enqueue + fan-out initiation time; exclude subscriber handler execution time; measured across 10000 iterations with 0–10 active subscribers |
| `subscribe()` latency | < 1 ms p95 | `performance.now()` wrap around `subscribe(eventType, handler)` call; measure registration time excluding history replay; measured across 1000 iterations |
| `unsubscribe()` latency | < 1 ms p95 | `performance.now()` wrap around `unsubscribe(subscriptionId)` call; measured across 1000 iterations |
| Delivery fan-out overhead (per subscriber, excluding handler time) | < 5 ms p95 | `performance.now()` measurement of the loop overhead from publish return to handler invocation start for each subscriber; measured with 0–100 subscribers |
| Event validation (`ViskodEventSchema.parse`) | < 5 ms p95 | `performance.now()` wrap around schema validation call on a valid event; measured across 10000 iterations across all 14 event types |
| Startup time (from `start()` to Active) | < 10 ms p95 | `performance.now()` from `start()` call to Active state transition; measured across 100 cold starts |

These budgets exclude subscriber handler execution time. The `publish()` budget covers the Event Bus's own work: validation, queue management, and fan-out dispatch initiation. Subscriber handlers run asynchronously and their execution time is bounded by `deliveryTimeout`.

---

## Observability

* **`EventBusDiagnostics` exposed via health endpoint:** The `EventBusDiagnostics` interface (totalPublished, totalDelivered, totalFailed, activeSubscriptions, queueSize, subscriberStats) must be queryable at runtime through the diagnostics subsystem.
* **Subscribe events logged at INFO level:** Every successful subscription is logged with subscription ID, event type, and timestamp.
* **Unsubscribe events logged at INFO level:** Every successful unsubscription is logged with subscription ID and timestamp.
* **Delivery timeouts logged at WARN level:** Every `EB_DELIVERY_TIMEOUT` is logged with subscription ID, event type, timeout duration, and event correlation ID.
* **Delivery failures logged at ERROR level:** Every `EB_DELIVERY_FAILED` is logged with subscription ID, event type, error message, and event correlation ID.
* **Queue overflow logged at WARN level:** Every dropped event due to `EB_QUEUE_FULL` is logged with current queue size and max queue size.
* **State transitions logged at INFO level:** Every lifecycle transition (Created → Active, Active → Draining, Draining → Stopped, Active → Stopped) is logged with the previous state, new state, and timestamp.
* **Queue depth monitored:** The `queueSize` field of `EventBusDiagnostics` must be exposed and monitored. Queue depth should generally be near zero. Sustained non-zero queue depth indicates a slow subscriber.
* **Subscriber stats queryable:** Per-subscription delivery and failure counts must be queryable via `subscriberStats` to identify slow or failing subscribers.

---

## Configuration

| Key | Type | Default | Validation | Description |
|-----|------|---------|------------|-------------|
| `maxQueueSize` | `number` | `10000` | `z.number().int().positive()` | Maximum queue depth before oldest events are dropped |
| `deliveryTimeout` | `number` | `5000` | `z.number().int().positive()` | Maximum milliseconds a subscriber handler may execute |
| `errorStrategy` | `'continue' \| 'pause-subscriber'` | `'continue'` | `z.enum(['continue', 'pause-subscriber'])` | Behaviour when a subscriber handler fails |
| `enableHistory` | `boolean` | `false` | `z.boolean()` | Whether to retain a history buffer for late subscribers |
| `historySize` | `number` | `100` | `z.number().int().positive()` | Number of events to retain in the history buffer |

All configuration is provided via `EventBusOptions` at factory creation time. There are no environment variable mappings or configuration file keys. The configuration is validated by the factory using Zod schemas derived from the `EventBusOptions` interface.

---

## Failure and Recovery

* **Event Bus crash or unhandled exception:** If the Event Bus process crashes, all in-memory state (subscriptions, queue, history buffer) is lost. Subsystems that depend on the Event Bus must re-create their subscriptions after the Event Bus is restarted. The Event Bus maintains no persistent state.
* **Subscriber handler timeout:** If a handler exceeds `deliveryTimeout`, the timeout is treated as a delivery failure. If `errorStrategy = 'continue'`, the subscriber remains active and receives subsequent events. If `errorStrategy = 'pause-subscriber'`, the subscriber is paused and must be manually resumed.
* **Subscriber handler throws:** Same recovery as timeout — handled per `errorStrategy`. The error is logged. Other subscribers are unaffected.
* **Queue overflow:** Oldest events are dropped. New events continue to be accepted. The diagnostic counter `EB_QUEUE_FULL` is incremented. Publishers are not notified of dropped events downstream.
* **History buffer full (circular):** When the history buffer exceeds `historySize`, the oldest buffered event is evicted. New events continue to be buffered. The history buffer is circular; this is normal operation, not a failure.
* **Subscriber paused (via error strategy):** A paused subscriber receives no further events until explicitly resumed. The pause is indicated in the internal `SubscriptionRecord.paused` field. A resume mechanism (e.g., `resume(subscriptionId)`) must be available.
* **Downstream component recovery:** If a subscriber (e.g., VCE) restarts, it must re-subscribe to the Event Bus. If `enableHistory` is `true`, the subscriber receives historical events upon re-subscribing. If `enableHistory` is `false`, events published during the downtime are lost.

---

## Compatibility

### Breaking-Change Policy

A change to the Event Bus interface is considered breaking if it:

1. Removes or renames a method on the `EventBus` interface (`publish`, `subscribe`, `unsubscribe`)
2. Changes the signature of a public method (e.g., `publish` returns `Result<EventId>` instead of `Result<void>`)
3. Removes a field from `EventBusOptions` that consumers depend on
4. Changes the `EventBusDiagnostics` interface in a way that existing consumers cannot deserialize
5. Changes the `Subscription` interface fields
6. Removes or renames an error code (`EB_PUBLISH_INVALID`, etc.)
7. Changes the state transition model behavior (e.g., removes `Draining` state)
8. Changes the `errorStrategy` values without backward compatibility
9. Changes the default for a configuration option without a migration path

### Non-Breaking Changes

1. Adding a new optional field to `EventBusOptions` with a sensible default
2. Adding a new method to `EventBus` (e.g., `resume(subscriptionId)`)
3. Adding a new field to `EventBusDiagnostics`
4. Adding a new error strategy option (`'retry'`) while preserving existing options
5. Adding a new lifecycle state that does not affect existing transitions

### Migration Strategy

Every breaking change requires:

1. A version increment of the Event Bus specification
2. A migration guide documenting the change, rationale, and upgrade steps
3. A deprecation window of at least one minor version where the old interface remains available alongside the new one
4. Decision record in `/decisions/` documenting the rationale
5. Notification to all consumer specification owners

### Deprecation Window

* Non-breaking additions: no deprecation window required, available immediately
* Breaking changes: minimum one minor version deprecation window before removal
* Emergency security fixes: may bypass the deprecation window with documented justification

---

## Testing Requirements

### Unit Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| `publish()` delivers event to all matching subscribers | Happy path | All subscribers matching `eventType` receive the event; non-matching subscribers do not receive it |
| `publish()` never delivers to non-matching subscribers | Isolation | Subscribers registered for `"BR_EVENT:BROWSER_STARTED"` do not receive `"BR_EVENT:CAPTURE_COMPLETED"` events |
| `publish()` rejects invalid event (unknown `eventType`) | Error path | `Result { ok: false, error: { code: 'EB_PUBLISH_INVALID' } }` returned |
| `publish()` rejects invalid event (missing required field) | Error path | `Result { ok: false, error: { code: 'EB_PUBLISH_INVALID' } }` returned |
| `subscribe()` registers handler and returns valid `Subscription` | Happy path | `Subscription` returned with UUID `id`, matching `eventType`, and ISO 8601 `createdAt` |
| `subscribe()` rejects unknown `eventType` | Error path | `Result { ok: false, error: { code: 'EB_SUBSCRIBE_INVALID_TYPE' } }` returned |
| `subscribe()` with `filter` only delivers to handler when filter returns `true` | Filter | Handler invoked only for events passing the filter predicate; filtered events not delivered |
| `subscribe()` with `priority` delivers in correct order | Priority | Higher priority subscribers receive events before lower priority subscribers of the same `eventType` |
| `subscribe()` with `once: true` auto-unsubscribes after first delivery | One-shot | Handler invoked exactly once; subsequent publishes of matching type not delivered to this subscriber |
| `unsubscribe()` removes handler and prevents further deliveries | Happy path | Handler not invoked for subsequent publishes of matching type |
| `unsubscribe()` with non-existent subscription ID is idempotent | Idempotency | `Result { ok: true, value: void }` returned; no error |
| Subscriber handler error with `errorStrategy = 'continue'` does not block other subscribers | Error isolation | Subscriber A throws; subscriber B's handler is still invoked; subscriber A is not paused |
| Subscriber handler error with `errorStrategy = 'pause-subscriber'` pauses only the failing subscriber | Error isolation | Subscriber A throws; subscriber A is paused; subscriber B's handler is still invoked; subscriber A not invoked on subsequent publishes |
| Subscriber handler timeout is handled per `errorStrategy` | Timeout | Handler exceeding `deliveryTimeout` triggers appropriate error strategy behavior |
| Queue overflow drops oldest event | Queue management | When queue exceeds `maxQueueSize`, the oldest event is dropped; the newly published event is enqueued; diagnostic counter incremented |
| History buffer replays events to late subscriber | History | Subscriber registered after events were published receives historical events if `enableHistory = true` |
| History buffer respects `historySize` limit | History | When history buffer exceeds `historySize`, oldest buffered event is evicted |
| State transition Created → Active via `start()` | Lifecycle | `publish` and `subscribe` succeed after `start()` |
| State transition Active → Draining → Stopped via `drain()` | Lifecycle | In-flight deliveries complete; no new publications accepted during Draining; all subscriptions removed in Stopped |
| State transition Active → Stopped via `stop()` | Lifecycle | All subscriptions removed; queue flushed; history cleared |
| Any operation in Stopped state returns `EB_BUS_STOPPED` | Lifecycle | All `publish`, `subscribe`, and `unsubscribe` calls return error after stop |
| Handler receives frozen (immutable) event object | Immutability | Attempting to mutate the event object in a handler does not affect other subscribers' copies |
| Publisher receives no information about subscribers | Anonymity | `publish()` result contains no subscriber information |

### Integration Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| Browser Runtime publishes `BrowserStartedEvent` → Event Bus validates → delivers to stubbed VCE subscriber | End-to-end publish flow | Stubbed VCE subscriber receives validated `BrowserStartedEvent` with correct payload |
| Browser Runtime publishes `CaptureCompletedEvent` → Event Bus delivers → VCE subscriber receives; Diagnostics subscriber also receives if registered | Multi-subscriber fan-out | Both subscribers receive the event independently |
| Multiple publishes in rapid succession arrive in order | Ordering | Events are delivered to each subscriber in publication order |
| Stubbed subscriber throws → VCE subscriber unaffected | Error isolation | VCE subscriber receives event despite other subscriber failure |
| Event Bus drains and stops → Browser Runtime publish returns error | Shutdown | `EB_BUS_STOPPED` returned; no events lost after drain completes |
| Subscriber subscribes late with history enabled → receives previously published events | History replay | Late subscriber receives all events from the history buffer in publication order |

### Contract Tests

| Test | Scope | Expected Result |
|------|-------|----------------|
| `EventBus` interface matches `docs/architecture.md` §Event Bus | Architecture contract | Interface defines `publish`, `subscribe`, `unsubscribe` with correct signatures; Event Bus owns transport, not business logic |
| `EventBusOptions` interface matches specification | Interface contract | All five options present with correct types and defaults |
| `EventBusDiagnostics` interface matches specification | Interface contract | All six fields present with correct types |
| Event Bus validates every event against `ViskodEventSchema` before delivery | Security contract | Invalid events rejected; valid events delivered |
| Event Bus never exposes publisher identity through any public API | Anonymity contract | No field on `Subscription`, `EventBusDiagnostics`, or `Result` returns contains publisher information |
| Event Bus never exposes subscriber identity to publishers | Anonymity contract | `publish()` returns `Result<void>` with no subscriber information |
| All error codes match specification | Error contract | Six error codes defined: `EB_PUBLISH_INVALID`, `EB_SUBSCRIBE_INVALID_TYPE`, `EB_DELIVERY_TIMEOUT`, `EB_DELIVERY_FAILED`, `EB_QUEUE_FULL`, `EB_BUS_STOPPED` |
| State transitions match specification | State contract | Created → Active → Draining → Stopped; no invalid transitions possible |

### End-to-End Acceptance Criteria

| Test | Scope | Expected Result |
|------|-------|----------------|
| Full Viskod startup: CLI creates Event Bus → BR subscribes to viewport commands → VCE subscribes to BR events → browser launches → `BrowserStartedEvent` flows BR → Event Bus → VCE | Startup flow | VCE receives `BrowserStartedEvent` through Event Bus; no direct BR → VCE call |
| Capture flow: user selects element → Selection Engine publishes → BR captures → BR publishes `CaptureCompletedEvent` → Event Bus delivers to VCE → VCE builds context packet | Capture flow | Full chain executes without direct BR → VCE dependency |
| Browser crash: BR publishes `BrowserDisconnectedEvent` → Event Bus delivers to VCE and Studio → Studio displays disconnection state | Error flow | Both VCE and Studio receive the event; no stale state |

---

## Acceptance Criteria

Before this specification can move to Approved:

- [ ] `publish()` delivers to all matching subscribers
- [ ] `publish()` never delivers to non-matching subscribers
- [ ] `publish()` rejects invalid events with `EB_PUBLISH_INVALID`
- [ ] `subscribe()` returns valid `Subscription` with UUID, eventType, and ISO 8601 timestamp
- [ ] `subscribe()` rejects unknown event types with `EB_SUBSCRIBE_INVALID_TYPE`
- [ ] `subscribe()` filter predicate correctly gates delivery
- [ ] `subscribe()` priority ordering is respected
- [ ] `subscribe()` `once: true` auto-unsubscribes after first delivery
- [ ] `unsubscribe()` removes handler and prevents further deliveries
- [ ] `unsubscribe()` is idempotent for non-existent subscription IDs
- [ ] Subscriber handler error with `errorStrategy = 'continue'` does not block other subscribers
- [ ] Subscriber handler error with `errorStrategy = 'pause-subscriber'` pauses only the failing subscriber
- [ ] Subscriber handler timeout handled per `errorStrategy`
- [ ] Queue overflow drops oldest event, not newest, and emits diagnostic
- [ ] History buffer replays events to late subscribers when `enableHistory = true`
- [ ] Event Bus owns no business logic (verify: no decisions about event content; no conditional logic based on payload fields; no transformation of events)
- [ ] Event Bus never initiates communication (verify: all actions triggered by external `publish`, `subscribe`, or `unsubscribe` calls; no timers, no polling, no proactive behavior)
- [ ] Publisher identity never exposed to subscribers (verify: no publisher information in delivered events beyond `source` field; no API returning publisher information)
- [ ] Subscriber identity never exposed to publishers (verify: `publish()` returns `Result<void>`; no API returning subscriber list to publishers)
- [ ] Events are immutable after publication (verify: `Object.freeze` or equivalent applied; subscriber mutations don't propagate)
- [ ] All six error codes (`EB_PUBLISH_INVALID`, `EB_SUBSCRIBE_INVALID_TYPE`, `EB_DELIVERY_TIMEOUT`, `EB_DELIVERY_FAILED`, `EB_QUEUE_FULL`, `EB_BUS_STOPPED`) defined and testable
- [ ] All four lifecycle states (Created, Active, Draining, Stopped) transition correctly
- [ ] `start()` transitions Created → Active
- [ ] `drain()` transitions Active → Draining → Stopped after in-flight deliveries complete
- [ ] `stop()` transitions Active → Stopped immediately
- [ ] `EventBusDiagnostics` exposes all six fields with correct values
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All contract tests pass
- [ ] Performance budgets met (publish p95 < 2 ms, subscribe/unsubscribe p95 < 1 ms, fan-out p95 < 5 ms per subscriber)
- [ ] No `any` types in the Event Bus public API
- [ ] All public methods return `Result<T>` conforming to SPEC-002
- [ ] Dependency direction verified: Event Bus consumes SPEC-002, SPEC-003, SPEC-005; Event Bus is consumed by SPEC-008, SPEC-009; no circular dependencies

---

## Open Implementation Decisions

| Decision ID | Description | Resolution |
|-------------|-------------|-----------|
| DEC-004 | Event Bus transport (in-process pub-sub vs IPC) | Determine whether Phase 1 Event Bus is purely in-process (Node.js EventEmitter pattern) or supports inter-process communication for future cross-process scenarios. In-process is the default for Phase 1. Record in `/decisions/DEC-004.md`. |
| DEC-002 | Serialisation format for events (JSON vs MessagePack) | Shared with SPEC-002 (shared-types). Affects whether the Event Bus stores opaque objects or serialised data in the queue and history buffer. JSON is the default until DEC-002 resolves. Record in `/decisions/DEC-002.md`. |

---

## Migration Considerations

This is a new specification with no predecessor. No migration is required.

When the Event Bus is first implemented:

1. All existing stubs, mocks, or temporary communication patterns between BR and VCE must be replaced with Event Bus publish/subscribe calls
2. Any direct callback registrations from BR to VCE must be removed
3. Any BR imports of VCE modules must be removed
4. The architecture document's prohibited dependency rules become enforceable at the implementation level

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| In-process pub-sub becomes bottleneck under high event volume | Low | Medium | Phase 1 targets single-developer usage with one browser context. Event volume is low. If volume increases, DEC-004 provides the path to IPC/separate process transport. |
| Delivery timeout too short for real-world subscriber processing | Medium | Low | Default `deliveryTimeout` is 5000 ms. Subscribers performing heavy work should process asynchronously (acknowledge event, process in background). Timeout is adjustable via configuration. |
| `errorStrategy = 'pause-subscriber'` causes silent data loss if subscriber is not monitored | Medium | Medium | Paused subscribers are surfaced through `EventBusDiagnostics`. The diagnostics subsystem must alert on paused subscribers. Manual resume is an intentional design choice to prevent cascading failures. |
| History buffer replay causes unbounded `subscribe()` latency | Low | Low | History replay is synchronous only for the subscribing call. `historySize` defaults to 100 events. Even at 5 ms per validation, replay is bounded to ~500 ms. Subscribers should not depend on history as a primary data source. |
| Event Bus becomes a God object if future features accumulate on it | Medium | High | This specification explicitly forbids business logic in the Event Bus. The Event Bus transports. It does not transform, enrich, route conditionally, or persist. Any feature that requires these capabilities belongs in a separate subsystem. |
| Architecture violations (direct BR → VCE calls) persist in early implementation | Medium | High | Contract tests verify the dependency direction. Code review enforces the prohibited dependency rules from `docs/ARCHITECTURE_BASELINE.md`. Any direct dependency is a build failure. |

---

## Implementation Sequence

1. Create package directory `packages/event-bus/` per SPEC-001 conventions
2. Initialise `packages/event-bus/package.json` with TypeScript strict mode; dependencies on `@viskod/shared` (SPEC-002), `@viskod/event-schema` (SPEC-005)
3. Implement `EventBusOptions` type and Zod validation schema
4. Implement `Subscription` and `SubscriptionRecord` types
5. Implement `EventBusDiagnostics` interface
6. Implement lifecycle state machine: Created, Active, Draining, Stopped with transitions
7. Implement `EventBusFactory.create(options)` returning Event Bus in Created state
8. Implement `subscribe(eventType, handler, options?)` with event type validation, subscription registration, and optional filter/priority/once support
9. Implement `publish(event)` with `ViskodEventSchema` validation, queue management, and non-blocking fan-out delivery
10. Implement `unsubscribe(subscriptionId)` with idempotent removal
11. Implement delivery timeout enforcement per `deliveryTimeout` configuration
12. Implement error strategy handling (`continue` and `pause-subscriber`)
13. Implement queue overflow protection (drop oldest)
14. Implement optional history buffer (circular buffer, replay on subscribe)
15. Implement `EventBusDiagnostics` query method
16. Implement `drain()` and `stop()` lifecycle transitions
17. Implement `resume(subscriptionId)` for paused subscribers
18. Write unit tests for all acceptance criteria
19. Write integration tests with stubbed BR publisher and VCE subscriber
20. Write contract tests verifying architecture compliance
21. Run `tsc --noEmit --strict` and fix any errors
22. Run lint and fix any violations
23. Run all tests and verify they pass
24. Run performance benchmarks and verify budgets
25. Document DEC-004 (Event Bus transport) in `/decisions/DEC-004.md`
26. Update DEC-002 (serialisation format) with Event Bus context in `/decisions/DEC-002.md`

---

## Definition of Done

- [ ] `packages/event-bus/` directory exists with correct structure per SPEC-001
- [ ] `packages/event-bus/package.json` defines `@viskod/event-bus` with strict TypeScript config and correct dependencies
- [ ] `EventBus` interface implemented with `publish`, `subscribe`, `unsubscribe` methods
- [ ] `EventBusFactory` interface implemented with `create(options?)` returning Event Bus in Created state
- [ ] `EventBusOptions` type with all five configuration options and defaults implemented
- [ ] `Subscription` interface implemented
- [ ] `EventBusDiagnostics` interface implemented
- [ ] Lifecycle state machine (Created → Active → Draining → Stopped) implemented with correct transition guards
- [ ] Zod validation of all published events against `ViskodEventSchema` enforced
- [ ] Non-blocking fan-out delivery with per-subscriber timeout enforcement
- [ ] Error strategy (`continue` and `pause-subscriber`) implemented
- [ ] Queue overflow protection (drop oldest) with diagnostic counter implemented
- [ ] Optional history buffer with replay on late subscribe implemented
- [ ] Event immutability enforced (events frozen after validation)
- [ ] Publisher-subscriber anonymity enforced
- [ ] All six error codes implemented and testable
- [ ] TypeScript strict mode compiles without errors
- [ ] Zero `any` types in public API
- [ ] Zero business logic in any module (verify: grep for conditional logic on event payload fields)
- [ ] All public methods return `Result<T>` conforming to SPEC-002
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All contract tests pass
- [ ] All end-to-end acceptance criteria verified
- [ ] Performance benchmarks meet budgets
- [ ] Lint passes
- [ ] DEC-004 documented in `/decisions/DEC-004.md`
- [ ] DEC-002 updated with Event Bus context in `/decisions/DEC-002.md`
- [ ] No direct BR → VCE dependency exists in any source file
- [ ] No VCE subscription via direct callback (only through Event Bus)
- [ ] Specification status updated from Draft to Approved
