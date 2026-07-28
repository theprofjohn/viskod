# Specification Template

> **Version:** 1.0
> **Use:** Mandatory for every implementation specification in `/specs`

---

## Template

Every specification must include these sections. Sections marked `(if applicable)` are required only when relevant to the specification's scope.

```markdown
# TITLE

> **Specification ID:** SPEC-###
> **Version:** 1.0
> **Status:** Draft | Review | Approved | Implementing | Implemented | Superseded
> **Owner:**
> **Last Updated:** YYYY-MM-DD

---

## Architecture Sources

List every `/docs` document this specification implements.

```
* docs/architecture.md — dependency direction: Studio → VCE → Browser Runtime
* docs/visual-context-engine.md — VCE processing pipeline stages
* docs/glossary.md — canonical terminology
```

A specification with no architecture sources is invalid.

---

## Dependencies

Specifications that must be approved or implemented first.

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-### | Approved | Interface consumed |
| SPEC-### | Draft | Shared schema |

---

## Consumers

Specifications and components that depend on this one.

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-### | Draft | Calls public API |
| SPEC-### | Planned | Subscribes to events |

---

## Purpose

One paragraph describing what this specification defines and why it exists.

---

## Scope

What is covered.

---

## Non-Goals

What is explicitly NOT covered.

---

## Terminology

Terms specific to this specification. Reference `docs/glossary.md` for all canonical terms. Define only implementation-specific terms here.

---

## Runtime Boundary (if applicable)

The environment in which this component executes.

| Boundary | Responsibility |
|----------|---------------|
| Process | desktop / browser / plugin sandbox |
| Owns | state, resources, lifecycle |
| Forbidden | operations and imports this component must never perform |

---

## Responsibilities

Concrete, testable responsibilities. No vague language.

---

## Interfaces

### Public API

Every function, method, or endpoint.

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|

### Events Published (if applicable)

| Event | Payload Schema | When Published |
|-------|---------------|----------------|

### Events Subscribed (if applicable)

| Event | Source | Action |
|-------|--------|--------|

---

## Data Models

All structured data types this component owns or consumes.

Schema definitions using TypeScript interfaces or Zod schemas.

---

## State Model

Transitions, invariants, and lifecycle. Use state diagrams where helpful.

---

## Command Flows

Sequence diagrams or step-by-step descriptions for every command (synchronous call) path.

Label all arrows: `──calls──→`.

---

## Event Flows

Sequence diagrams or step-by-step descriptions for every event (asynchronous) path.

Label all arrows: `──events──→` and `──subscription──→`.

---

## Error Behaviour

For every failure mode:

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|

---

## Security Requirements

- Trust boundaries
- Validation rules for all external input
- Sensitive data handling
- Capability requirements

---

## Privacy Requirements

- Data collected and purpose
- Retention period
- Deletion mechanism
- What must not be collected

---

## Performance Budget

Measurable, verifiable targets.

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Startup time | < X ms | Benchmark suite |
| Operation latency | < X ms | Benchmark suite |

No targets like "fast" or "responsive" without a numeric bound.

---

## Observability

- Log levels and events
- Diagnostic signals
- Health check endpoints
- Metrics

---

## Configuration

- Configuration keys
- Defaults
- Validation rules
- Environment variable mappings

---

## Failure and Recovery

- What happens when this component fails
- How it recovers
- What downstream components should do

---

## Compatibility

- Breaking-change policy
- Migration strategy for breaking changes
- Deprecation window

---

## Testing Requirements

### Unit Tests
### Integration Tests
### Contract Tests
### End-to-End Acceptance Criteria

Every criterion must be verifiable.

---

## Acceptance Criteria

Before this specification can move to Approved:

1. ...
2. ...

---

## Open Implementation Decisions

Decisions deferred to implementation decision records.

---

## Migration Considerations

If this specification supersedes another, document the migration path.

---

## Risks

- Technical risks
- Sequencing risks
- Ambiguity risks

---

## Implementation Sequence

Ordered steps for implementation.

---

## Definition of Done

Checklist. Every item must be verified before this specification moves to Implemented.
```

---

## Prohibited Language

The following words and phrases are prohibited in specifications **unless accompanied by a measurable or verifiable definition**:

| Prohibited | Acceptable Alternative |
|-----------|----------------------|
| fast | "under 500 ms at p95" |
| scalable | "supports up to N concurrent connections" |
| secure | "all external input validated against schema; no secrets in logs" |
| user-friendly | "keyboard-navigable; WCAG 2.1 AA compliant" |
| robust | "recovers from X failure within Y ms" |
| performant | "processes N operations per second" |
| intuitive | Not acceptable; use concrete UX requirements |
| reliable | "99.9% successful operations under load X" |
| simple | Not acceptable; describe the design |
| clean | Not acceptable; describe the architecture |

---

## Validation Checklist

Before submitting for review, verify:

- [ ] Architecture sources listed and correct
- [ ] Dependencies identified
- [ ] No vague acceptance criteria
- [ ] All interfaces have input/output schemas
- [ ] All errors defined
- [ ] State transitions explicit
- [ ] Command and event flows labelled separately
- [ ] Performance budgets are numeric
- [ ] Security and privacy sections complete
- [ ] Testing requirements defined
- [ ] No architectural violations
