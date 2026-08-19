# Viskod 0.2.4-alpha Release Candidate

Viskod is a local-first visual context engine for AI-assisted software development.
It captures a selected UI target, preserves evidence, maps the target to probabilistic source guidance, prepares an agent-safe handoff, and supports human-reviewed before/after verification.

## Primary workflow

1. Run `viskod setup --project-root <project>`.
2. Open the application in Studio and select a target.
3. Describe the problem and expected result.
4. Prepare the handoff for OpenCode (or another structurally supported client).
5. Let the agent make the change.
6. Recapture, inspect BEFORE/AFTER/DIFF evidence, and record the human decision.

## RC capabilities

- Browser-backed target selection and context capture.
- Persisted issues, handoffs, reviews, feedback, and restart recovery.
- MCP server with 31 runtime tools; setup verifies the required subset of 8 tools.
- OpenCode configuration installation with preservation and idempotency behavior.
- Ranked route/import/source guidance with explicit confidence and qualification.
- Sanitized diagnostics, agent projections, and handoff context.
- Local visual review artifacts with a human decision boundary.

## Privacy model

Runtime, browser, captures, workflow state, and generated configuration remain local. Agent-facing projections omit raw packets, screenshots, secrets, cookies, tokens, and absolute source paths. Visual review images are local-sensitive artifacts and are not included in agent-safe context.

## Source guidance qualification

Source guidance is probabilistic, not exact ownership. Route, import, usage-site, confidence, qualification, and ambiguity metadata must be considered together. The RC preserves the Phase 37 route/import relevance behavior without changing calibrated confidence thresholds.

## Feedback

General and post-review feedback are persisted locally as sanitized, bounded records. Feedback does not silently change review decisions or inject raw agent conversation data.

## Proven environment

- Node.js 22 or newer.
- pnpm 9 or newer for repository development; the packed CLI requires Node 22+ and installs Playwright as a runtime dependency.
- Linux x64 was exercised for this RC. Other operating systems are not claimed as fully verified.
- OpenCode configuration generation and installed MCP initialize/tools-list were exercised from the RC tarball.
- Cursor and Claude configuration paths are structurally supported by the existing test suite; this RC does not claim runtime execution on those clients.

## Known boundaries

- Source guidance remains probabilistic.
- Studio retains maintainability debt.
- Application Shadow DOM and iframe traversal are bounded by browser/runtime boundaries.
- Visual review artifacts are local-sensitive and intentionally not agent-safe.
- Formal WCAG conformance is not claimed.
- Native OS verification is limited to the exercised environment.
- Process-local fork idempotency does not cover every crash/interrupted-process case.
- Remote navigation requires explicit user trust and validation.

This artifact is a release candidate only. It is not published to npm.
