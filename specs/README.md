# Implementation Specification Programme

> **Purpose:** Planning foundation for Viskod implementation specifications
> **Architecture Baseline:** `Viskod Architecture v1.0` (commit `df44214`, score 94/100)
> **Version:** 1.0
> **Status:** Active

---

## Purpose of `/specs`

`/specs` contains implementation specifications that define **how** the approved Viskod architecture will be built.

`/docs` defines **what** Viskod is — its product identity, architectural boundaries, subsystem responsibilities, and dependency direction.

`/specs` translates those architectural decisions into implementable engineering contracts: interfaces, data models, state machines, event schemas, performance budgets, and acceptance criteria.

Source code conforms to both. A specification that silently changes architecture is invalid.

---

## Authority Relationship

```
/docs (architecture)
  ↓ governs
/specs (implementation specifications)
  ↓ governs
source code
```

When a specification and the architecture conflict, the architecture wins. When source code and a specification conflict, the specification wins.

Architectural conflicts must be resolved through the RFC process (`docs/rfcs.md`), not by silently deviating in a specification.

---

## Distinction Between Architecture and Implementation Specifications

| Aspect | Architecture (`/docs`) | Implementation (`/specs`) |
|--------|----------------------|--------------------------|
| Purpose | Define system boundaries | Define buildable contracts |
| Scope | Subsystem responsibilities, dependencies, data flow | Interfaces, data models, state, error behaviour |
| Granularity | Subsystems | Components, modules, APIs |
| Examples | "Browser Runtime owns browser lifecycle" | "BrowserRuntime.launch() returns BrowserHandle" |
| Locking | Frozen; RFC required | Evolves with implementation |
| Authority | Highest | Second to architecture |

---

## Specification Lifecycle

Every specification progresses through these statuses:

| Status | Meaning |
|--------|---------|
| **Draft** | Initial proposal; not yet reviewed |
| **Review** | Under architectural and technical review |
| **Approved** | Passed all acceptance gates; ready for implementation |
| **Implementing** | Under active development |
| **Implemented** | Delivered; conforming source code exists |
| **Superseded** | Replaced by a newer specification |

Transitions:

```
Draft → Review → Approved → Implementing → Implemented
                      ↑
                 Superseded
```

A specification may return to Draft if review reveals architectural issues. A specification moves to Superseded only when a replacement specification reaches Approved.

---

## Ownership Rules

- Every specification has one primary owner.
- The owner is responsible for keeping the specification aligned with architecture.
- The owner manages the specification through its lifecycle.
- Implementation may be delegated; architectural alignment may not.

---

## Change-Control Rules

- A specification in `Approved` or later status requires explicit review before modification.
- Modifications that touch interfaces, schemas, or data models require dependent specification owners to acknowledge the change.
- Breaking changes in `Implementing` or `Implemented` specifications require a migration plan.
- Architectural changes require an RFC regardless of specification status.

---

## Validation Expectations

Before a specification moves to `Approved`, it must:

1. Pass all applicable acceptance gates (see `ACCEPTANCE_GATES.md`)
2. Be reviewed by the owner of any upstream architecture document
3. Have its dependency specifications identified and acknowledged
4. Include measurable acceptance criteria — no vague requirements

Vague phrases prohibited in specifications: "fast", "scalable", "secure", "user-friendly", "robust", "intuitive", "performant" — unless accompanied by a measurable definition.

---

## Reference Documents

| Document | Purpose |
|----------|---------|
| `SPEC_INDEX.md` | Canonical inventory of all specifications |
| `SPEC_DEPENDENCY_MAP.md` | Implementation dependency graph and critical path |
| `SPEC_TEMPLATE.md` | Mandatory template for every specification |
| `ACCEPTANCE_GATES.md` | Gates specifications must pass before approval |
| `PROGRAMME_REPORT.md` | Analysis, recommendations, and programme plan |
| `decisions/README.md` | Recording implementation-level decisions |
