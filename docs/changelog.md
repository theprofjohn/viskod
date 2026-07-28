
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
