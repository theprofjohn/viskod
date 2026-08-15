
> **Project Changelog**
>
> Version: 1.0
>
> Status: **Living Document**

---

# Purpose

The Changelog records significant changes made to Viskod across releases.

Its purpose is to provide a transparent history of platform evolution for users, contributors and integrators.

The changelog documents released behaviour.

It does not replace Git history or RFCs.

---

# Design Philosophy

The changelog follows one principle:

> **Every meaningful change should have a discoverable history.**

Changes should be grouped by release and written from the perspective of platform consumers rather than implementation details.

---

# Scope

The changelog should record:

* new platform capabilities
* public API additions
* breaking changes
* deprecations
* performance improvements
* security improvements
* documentation improvements
* bug fixes that affect observable behaviour

The changelog should not include:

* internal refactoring
* code formatting
* routine dependency updates
* CI maintenance
* temporary experiments
* unreleased work

---

# Versioning

Viskod follows **Semantic Versioning**.

```text id="v8k4qm"
MAJOR.MINOR.PATCH
```

Meaning:

| Version | Description                   |
| ------- | ----------------------------- |
| Major   | Breaking public changes       |
| Minor   | Backwards-compatible features |
| Patch   | Backwards-compatible fixes    |

---

# Release Structure

Each release should contain:

```text id="m5z2xr"
Version

Release Date

Summary

Added

Changed

Improved

Fixed

Deprecated

Removed

Security

Migration Notes

References
```

Sections without entries may be omitted.

---

# Release Categories

## Added

New platform capabilities.

Examples:

* new SDK
* new Plugin API
* new Browser Runtime capability
* new Context Packet fields

---

## Changed

Observable behaviour changes that remain compatible.

Examples:

* improved workflows
* revised defaults
* updated API semantics
* documentation updates

---

## Improved

Performance or quality improvements.

Examples:

* faster Context Packet generation
* reduced memory usage
* improved diagnostics
* enhanced developer experience

---

## Fixed

Corrections to observable platform behaviour.

Examples:

* incorrect event ordering
* browser capture issue
* plugin loading bug
* workspace synchronisation issue

---

## Deprecated

Features scheduled for future removal.

Every deprecation should include:

* reason
* replacement
* expected removal version

---

## Removed

Features permanently removed from the platform.

Removal should normally follow a documented deprecation period.

---

## Security

Security-related improvements including:

* vulnerability fixes
* permission enhancements
* authentication improvements
* isolation improvements
* privacy enhancements

Sensitive implementation details should not be disclosed unnecessarily.

---

# Release Example

```text id="n7p1yt"
## Version 1.2.0

Added

- Plugin capability negotiation
- New Browser Runtime diagnostics

Improved

- Faster Context Packet generation

Fixed

- Plugin activation ordering

Deprecated

- Legacy capture API
```

This example illustrates the preferred release style.

---

# Release Log

## Version 0.3.0-alpha

Release Date: 2026-08-15

Summary

Phase 31: true safe before/after visual review. Review verification now
captures real target crops, compares actual pixels, renders BEFORE/AFTER/DIFF
in Studio, and keeps the raw images strictly local-sensitive — never part of
the agent-safe packet.

Added

- Local-sensitive visual review artifacts (target crop + bounded context
  padding) captured through the Phase 28B exact-target pipeline
- Real pixel comparison (PNG decode + per-pixel diff) with a highlighted
  diff image and persisted metrics (changed pixels, ratio, config version)
- Geometry comparison as separate evidence (position/size deltas)
- Studio review screen renders BEFORE / AFTER / DIFF images from protected
  opaque artifact endpoints (`/review/artifact/<id>`)
- One-time local visual review consent banner; policy persisted in
  `.viskod/settings.json` (default disabled — Phase 29 privacy stance)
- Optional decision note textarea; note persists with the decision
- New `unchanged`/`incomparable`/`visual_unavailable` comparison semantics —
  a `possible`-strength identity or environment mismatch is never reported
  as a confident change

Changed

- Target identity in review comparisons uses the Phase 28B stable-identity
  model (display labels are presentation, never identity) — fixes
  VISKOD-AUDIT-005 unchanged-false-positives
- The before baseline is captured when the agent handoff is prepared — before
  the coding agent modifies the page — and tied durably to the issue lineage
- Review artifacts are atomic (temp write → validate → rename) and paired by
  explicit artifact ids that survive Studio restarts

Fixed

- VISKOD-AUDIT-004: before/after review now persists and compares actual
  screenshots instead of metadata only
- VISKOD-AUDIT-005: unchanged targets no longer report changed
- VISKOD-AUDIT-023: decision notes entered in Studio are persisted
- Phase 31A closure: a BEFORE baseline captured before the fix survives
  Studio restart and is reused byte-identical for post-restart verification
  (never recaptured); missing/corrupt baselines fail closed with typed
  errors; consent enable/decline persist across restarts; malformed
  settings fail closed to disabled; corrupt artifact-file reads now
  classify as `ARTIFACT_INVALID_IMAGE`; consent saves retry transient
  Windows rename locks so the preference is never silently dropped

Security

- Review images are marked sensitive/localOnly, never enter
  `get_handoff_context` or the agent-safe packet, and are served only through
  validated opaque Studio endpoints (traversal/malformed ids rejected)
- Visual review artifact policy defaults disabled; enabling requires the
  explicit one-time consent; persisted consent never changes the Phase 29
  agent-safe screenshot policy (regression-tested after restart)

## Version 0.2.3-alpha

Release Date: 2026-08-12

Summary

First release produced by the deterministic release gate: a tagged alpha is
reproducible from a clean checkout, runs the CI-compatible suite plus the
full UI workflow dogfood coverage, verifies the exact packed artifact, and
publishes only after version/tag consistency, the end-to-end smoke, and
post-publish verification pass.

Added

- `viskod --version` reports the packaged CLI version
- Repo-contained dogfood fixture (`examples/dogfood-app`) so the overlay →
  issue → handoff → review → setup suite runs inside the release gate
- Packed-artifact verification (name, version, entrypoint, no repository or
  secret files) before publication

Changed

- `release:check` no longer depends on an external fixture application on a
  developer machine path
- Test suite split: `test:ci` (CI-compatible, excludes browser dogfood) and
  `test:dogfood` (full UI workflow suite)
- MCP `initialize` reports the packaged CLI version instead of a stale
  hard-coded string

Fixed

- Source-hint results could be stale: elements on the same route sharing
  tag/class/id but with different visible text collided in the engine cache
- Handoff briefs lost the source-hint status when persisted (schema omitted
  the field)
- CLI `start` banner reported an outdated hard-coded version

---

# Migration Notes

Breaking releases should provide migration guidance.

Migration notes should include:

* affected APIs
* behavioural changes
* compatibility considerations
* recommended upgrade path

Migration guidance should prioritise clarity.

---

# Compatibility

Every release should indicate whether it:

* is fully backwards compatible
* contains deprecated behaviour
* introduces breaking changes

Compatibility status should be explicit.

---

# References

Release notes may reference:

* RFCs
* API documentation
* migration guides
* release documentation
* security advisories

References should help users understand the rationale behind changes.

---

# Documentation Policy

Documentation updates should accompany relevant releases.

The following documents should remain synchronised where applicable:

* Product
* Architecture
* SDK
* Plugin API
* API Reference
* Design Principles
* Governance
* Roadmap

Documentation drift should be corrected before release.

---

# Release Workflow

Recommended workflow:

```text id="q3h8lw"
Implementation

↓

Testing

↓

Documentation Review

↓

Version Assignment

↓

Release Notes

↓

Publication
```

Releases should reflect documented platform behaviour.

---

# Historical Integrity

Published changelog entries should not be rewritten except to:

* correct factual errors
* fix formatting
* add missing references

Historical records should remain trustworthy.

---

# Relationship to Other Documents

The Changelog complements:

* Roadmap
* Governance
* RFCs
* Release
* API Reference

The Roadmap describes future direction.

The Changelog records completed evolution.

---

# Invariants

The Changelog guarantees:

* transparent release history
* consistent release structure
* semantic versioning
* explicit compatibility information
* documented public changes
* traceable platform evolution

These guarantees should remain stable throughout the lifetime of the project.

---

# Changelog North Star

The Changelog exists to provide a complete, trustworthy and user-focused history of Viskod's evolution.

Its responsibility is to communicate what changed, why it changed and how those changes affect platform users, contributors and integrators while preserving an accurate historical record across every release.
