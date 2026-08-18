
> **Contribution Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

This document defines how contributors participate in the development of Viskod.

Its purpose is to ensure all contributions maintain the architectural integrity, quality standards and long-term vision of the Visual Context Platform.

Every contribution should improve the platform.

No contribution should compromise its design principles.

---

# Design Philosophy

The contribution process follows one principle:

> **Architecture before implementation.**

Code should always follow the documented architecture rather than redefine it.

---

# Contribution Objectives

The contribution process should:

* preserve architectural consistency
* maintain code quality
* encourage collaboration
* minimise regressions
* improve documentation
* enable predictable reviews

Every accepted contribution should move the platform closer to its long-term vision.

---

# Who Can Contribute

Contributions are welcome for:

* bug fixes
* performance improvements
* documentation
* accessibility
* framework adapters
* developer tooling
* testing
* plugins
* SDK improvements

Large architectural proposals should be discussed before implementation.

---

# Before You Start

Before writing code, contributors should:

* read the architecture documentation
* understand the subsystem involved
* search for existing issues
* review open pull requests
* discuss significant changes

Understanding the architecture is considered part of implementation.

---

# Contribution Workflow

The expected workflow is:

```text id="c9f4kr"
Fork Repository

↓

Create Branch

↓

Implement Changes

↓

Run Verification

↓

Submit Pull Request

↓

Code Review

↓

Merge
```

Every contribution should follow the same workflow.

---

# Branch Naming

Recommended branch naming:

```text id="g3w8tp"
feature/<name>

fix/<name>

docs/<name>

refactor/<name>

test/<name>

perf/<name>

chore/<name>
```

Branch names should remain concise and descriptive.

---

# Coding Standards

Contributors should:

* follow project formatting rules
* maintain consistent naming
* write readable code
* avoid unnecessary abstraction
* minimise complexity
* preserve determinism

Code readability is prioritised over cleverness.

---

# Documentation

Changes affecting behaviour should update:

* architecture documents
* API documentation
* plugin documentation
* SDK documentation
* user guides where applicable

Documentation should evolve alongside the implementation.

---

# Testing Requirements

Every contribution should:

* pass static analysis
* pass formatting checks
* pass unit tests
* pass integration tests
* preserve performance budgets

New functionality should include appropriate automated tests.

---

# Pull Requests

Every pull request should describe:

* what changed
* why it changed
* architectural impact
* testing performed
* compatibility considerations

Pull requests should remain focused on a single logical change.

---

# Code Review

Reviews should evaluate:

* correctness
* architecture
* readability
* maintainability
* performance
* security
* testing

Reviews should focus on improving the platform rather than individual coding styles.

---

# Architectural Changes

Architectural modifications should include:

* design rationale
* alternatives considered
* compatibility impact
* migration strategy
* documentation updates

Major architectural decisions should be reviewed before implementation begins.

---

# Commit Messages

Commit messages should be concise and descriptive.

Recommended style:

```text id="n6v2pq"
feat:

fix:

docs:

refactor:

perf:

test:

chore:
```

Each commit should describe a single logical change.

---

# Issue Reporting

Bug reports should include:

* expected behaviour
* observed behaviour
* reproduction steps
* environment information
* relevant diagnostics

Clear reports improve investigation quality.

---

# Feature Requests

Feature proposals should explain:

* the problem
* proposed solution
* architectural impact
* alternatives considered
* expected benefits

Features should solve real user problems rather than add unnecessary complexity.

---

# Review Criteria

A contribution may be rejected if it:

* violates architectural principles
* reduces maintainability
* introduces unnecessary complexity
* weakens security
* lacks sufficient testing
* omits required documentation

Quality takes precedence over speed.

---

# Performance Expectations

Contributions should:

* preserve existing performance budgets
* avoid unnecessary allocations
* minimise blocking operations
* maintain responsiveness

Performance regressions should be justified and documented.

---

# Contributor Conduct

Contributors are expected to:

* communicate respectfully
* discuss ideas constructively
* review objectively
* accept feedback professionally
* prioritise the platform over personal preferences

Healthy technical discussion strengthens the project.

---

# Extensibility

As the project grows, contribution processes may expand to include:

* architecture review boards
* RFC process
* plugin certification
* security review workflow
* enterprise contribution policies
* release champions

Future processes should remain consistent with the project's design philosophy.

---

# Invariants

The contribution process guarantees:

* transparent collaboration
* documented architecture
* consistent review standards
* automated verification
* maintainable code quality
* reproducible development workflows

These guarantees should remain stable throughout the lifetime of the project.

---

# Contribution North Star

The contribution process exists to ensure every accepted change strengthens the Viskod platform.

Its responsibility is to guide contributors toward producing high-quality, well-tested and architecturally consistent improvements, enabling the Visual Context Platform to evolve without sacrificing clarity, reliability or long-term maintainability.
