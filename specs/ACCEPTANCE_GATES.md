# Acceptance Gates

> **Version:** 1.0
> **Purpose:** Gates that every specification must pass before moving to `Approved`
> **Architecture Baseline:** `Viskod Architecture v1.0`

---

## Overview

A specification must not move to `Approved` unless all applicable gates pass. Gates are cumulative — Gate 3 cannot pass if Gate 2 has not passed.

Gates are evaluated at the `Review → Approved` transition. A specification in `Draft` is not expected to pass all gates.

---

## Gate 1 — Architecture Alignment

The specification must align with the frozen architecture baseline.

| Criterion | Source |
|-----------|--------|
| Does not redefine subsystem ownership | `docs/architecture.md` |
| Respects dependency direction (VCE → BR, never BR → VCE) | `docs/architecture.md` §Dependency Rules |
| Preserves runtime boundaries (no boundary violation) | `docs/architecture.md` §Runtime Boundary |
| Uses canonical subsystem names | `docs/glossary.md` |
| Commands and events are labelled separately in diagrams | `docs/ARCHITECTURE_BASELINE.md` |
| No bi-directional dependency except through Event Bus | `docs/architecture.md` §Dependency Rules |
| VCE never receives browser events through direct callbacks | `docs/architecture.md` §Runtime Boundary |
| Event Bus is integration boundary, not business logic owner | `docs/glossary.md` §Event Bus |
| No stale references to Context Builder or Capture Manager | `docs/ARCHITECTURE_BASELINE.md` |

**Gate status:** All criteria must PASS.

---

## Gate 2 — Contract Completeness

Every external interaction must be fully defined.

| Criterion | Requirement |
|-----------|------------|
| Public interfaces defined | Every function/endpoint has signature, purpose, preconditions, postconditions, errors |
| Input schemas defined | Every input is typed and validated (Zod or equivalent) |
| Output schemas defined | Every output is typed and versioned |
| Error model defined | Every error has code, category, message, recovery guidance |
| State transitions defined | All valid states, transitions, and invariants documented |
| Events defined (if applicable) | Every published event has schema; every subscribed event has source |

**Gate status:** All applicable criteria must PASS.

---

## Gate 3 — Operational Completeness

The specification must define how the component behaves in production.

| Criterion | Requirement |
|-----------|------------|
| Performance budget | Numeric targets with measurement methods |
| Logging | Structured log events with levels |
| Diagnostics | Health signals and diagnostic endpoints |
| Observability | Metrics, traces, or equivalent visibility |
| Failure recovery | Recovery strategy for every defined failure mode |
| Configuration | Keys, defaults, validation, env-var mappings |

**Gate status:** All applicable criteria must PASS.

---

## Gate 4 — Security and Privacy

The specification must define its security and privacy posture.

| Criterion | Requirement |
|-----------|------------|
| Trust boundaries | Explicit; what is trusted, what is not |
| Permissions | Required capabilities documented |
| Input validation | All external input validated before processing |
| Sensitive data handling | What is collected, how it is protected, what is excluded |
| Local-first behaviour | No cloud requirement for core functionality |
| No secrets in logs, events, or diagnostics | Explicit exclusion documented |

**Gate status:** All applicable criteria must PASS.

---

## Gate 5 — Testability

The specification must be testable as written.

| Criterion | Requirement |
|-----------|------------|
| Unit-test requirements | Isolated, deterministic, no external dependencies |
| Integration-test requirements | Contracts validated across boundaries |
| Contract-test requirements | Stable interfaces protected from regression |
| End-to-end acceptance criteria | Verifiable, reproducible |
| Deterministic fixtures | Test data is version-controlled, not production data |

**Gate status:** All applicable criteria must PASS.

---

## Gate 6 — Build Readiness

The specification must be ready for implementation.

| Criterion | Requirement |
|-----------|------------|
| No unresolved architectural decisions | Open questions documented in `decisions/` |
| Dependencies approved | All upstream specifications at `Approved` or `Implementing` |
| No ambiguous ownership | Single owner, clear scope |
| Implementation sequence defined | Ordered steps in the specification |
| Definition of Done present | Checklist with verifiable items |

**Gate status:** All criteria must PASS.

---

## Gate Evaluation Process

1. Specification author self-assesses against all gates.
2. Architecture reviewer independently verifies Gate 1.
3. A specification owner from each dependency verifies Gate 2 criteria relevant to their interface.
4. A reviewer verifies Gates 3–6.
5. All gate failures must be resolved before `Approved`.

---

## Partial Applicability

Not every gate criterion applies to every specification.

- A specification for a pure data model (e.g., `context-packet-schema.md`) may have no command flows, no event flows, and no runtime boundary. Omit those criteria.
- A specification for a CLI tool may have no event subscriptions. Omit that criterion.
- The author must explicitly note which criteria are "not applicable" with a brief justification.

---

## Re-evaluation Triggers

A specification must be re-evaluated against applicable gates when:

- Its architecture sources change (Rare — requires RFC)
- A dependency specification changes its public interface
- The specification's own status changes to `Implementing` (confirm gates still pass)
- A gate failure is discovered during implementation
