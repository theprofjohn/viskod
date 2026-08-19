# Phase 36A — Beta Feedback & Sanitized Diagnostics

## 1. Executive summary
Implemented local-only product feedback as a separate bounded artifact. Feedback is optional, diagnostics are explicit opt-in, and no feedback/network submission or telemetry path was added.

## 2. Existing capability reuse
The implementation reuses `@viskod/shared` redaction, existing `.viskod` persistence conventions, Studio workflow state, review state, and doctor checks. VisualIssue and VisualReview contracts remain separate.

## 3. Feedback semantic boundary
`FeedbackArtifact` evaluates Viskod's usefulness or records product feedback. VisualIssue remains the user's application problem; VisualReview decisions remain accepted/rejected/follow-up outcomes.

## 4. FeedbackArtifact schema
Version 1 contains `schemaVersion`, opaque UUID `feedbackId`/`requestId`, timestamp, category, optional usefulness/reasons, bounded note, optional issue/handoff/review opaque IDs, and `diagnosticsIncluded` plus a strict diagnostic projection.

Categories: workflow, target-selection, source-resolution, agent-handoff, verification, setup-runtime, accessibility, documentation, feature-request, other. Notes are limited to 4,000 characters; diagnostic error codes are limited to 20 entries.

## 5. Persistence/atomicity
Each artifact is written independently under `.viskod/feedback/<feedbackId>.json` using temporary-file rename. Malformed records are skipped. Repeated request IDs return the existing artifact, preventing double-submit duplicates.

## 6. Post-verification usefulness flow
The decided review screen retains the existing review decision wording and exposes an optional feedback action. The feedback form offers Yes/Partly/No usefulness, optional reason, note, preview, copy, and local save. Skipping it leaves the review decided.

## 7. General Studio feedback
Idle Studio exposes General feedback without target selection, issue creation, or handoff preparation. The form supports category, note, diagnostics opt-in, preview, copy, and local save. History is bounded and separate from `/state`.

## 8. Diagnostic allowlist
Only schema-version, Viskod/runtime versions, platform/architecture, setup/MCP/browser statuses, project mode/count, workflow stage, source status/qualification, visual review status, bounded error codes, and Studio health are accepted.

## 9. Explicit diagnostic exclusions
The diagnostic schema has no fields for source code, DOM text, screenshots/PNG bytes, raw packets, persisted packets, absolute paths, executable paths, credentials, tokens, environment variables, cookies, storage, conversations, shell history, or command lines.

## 10. Redaction
Allowlisting is primary. User-entered notes and report text pass through the existing shared redaction and path/control-character sanitization primitive.

## 11. Privacy E2E
The mandatory privacy fixture and rendered Studio assertions are described below.

The self-contained rendered E2E fixture at `examples/phase36-feedback-privacy/` seeds a secret token, password-like value, credentialed URL, email, absolute-path marker, DOM secret, screenshot bytes, and fake environment marker. The Studio journey enables diagnostics, previews and saves feedback, then inspects persisted JSON and rendered Markdown; none of the seeded prohibited values appear. The same suite verifies post-review Partly feedback, reason capture, review-ID linkage, unchanged decided review state, idle feedback with unchanged issue count, oversized-input rejection, and duplicate request-ID behavior.

## 12. Markdown export
`generateFeedbackMarkdownReport` emits a compact copyable report with category, usefulness, note, reasons, allowlisted diagnostics, and opaque feedback ID.

## 13. JSON export
`generateFeedbackJsonReport` emits only the validated FeedbackArtifact and approved diagnostics. No logs, packets, screenshots, or arbitrary nested input are serialized.

## 14. External GitHub/support action
The repository metadata provides `https://github.com/theprofjohn/viskod/issues`. Studio exposes an explicit `Open GitHub Issues` action with a public-issue warning and no automatic attachment or query-string diagnostics. No GitHub API integration or automatic submission exists.

## 15. Doctor semantic correction
Doctor checks are classified required, recommended, or informational. Required failures control the exit code. Studio reachability and agent configuration are recommendations; summaries report `Recommended attention` instead of claiming all checks passed.

## 16. CLI report output
`viskod doctor --report` and `viskod doctor --json` use the sanitized doctor projection. Human output reports required failures and recommendation attention without exposing project or executable paths.

## 17. Accessibility
Feedback controls are semantic labels, buttons, selects, bounded textareas, and an `aria-live` result region. Preview/copy/save are keyboard-reachable and routine state rendering retains the existing focus policy.

## 18. Tests added/changed

- `packages/shared/src/feedback.test.ts`: 4 focused tests for schema bounds, opt-in exclusion, atomic persistence/malformed files/concurrent idempotency, and report safety.
- `tests/e2e/feedback.test.ts`: 3 rendered E2E tests covering privacy, idle semantic separation, post-review usefulness, bounds, and duplicate request IDs.
- Existing Studio UI/studio suites: 27 UI tests plus 28 Studio tests passed.
- Existing setup doctor suite: 5 tests passed.

## 19. Exact validation results
Full validation passed: `pnpm typecheck`, `pnpm lint`, `pnpm test:ci` — 73 files / 1,094 tests, `pnpm test:e2e` — 15 files / 90 tests, `pnpm test:dogfood` — 7 files / 129 tests, `pnpm smoke:agent-workflow` — 26/26, `pnpm build:cli && node scripts/verify-cli-artifact.mjs`, and `pnpm release:check`. The source CLI `doctor --report --json` emitted the shared path-free diagnostic projection; the Studio feedback collector and doctor projection both use `createDiagnosticSummary`.

## 20. Process/temp hygiene
Atomic temporary files are renamed on success. Malformed feedback files are ignored. No database, archive, telemetry process, or network worker was introduced.

## 21. Known limitations

No known privacy or validation limitation remains for Phase 36A. GitHub navigation is intentionally user-confirmed and public-facing; Viskod does not submit issues or attach local files.

## 22. Phase 36 beta worksheet


```text
Repository:
Framework:
Workspace type:
Task:
Target selected correctly? yes/no:
Source useful? yes/partly/no:
Agent had enough context? yes/partly/no:
Manual context added:
Agent edited correct code? yes/no:
Verification useful? yes/partly/no:
Time/friction notes:
Feedback ID:
Outcome:
```

## 23. Final status
**PASS** — Phase 36A feedback is local-first, semantically separate from VisualIssue/VisualReview, explicitly diagnostic-opt-in, allowlisted, redacted, bounded, atomic, idempotent, keyboard-accessible, user-shareable, and covered by passing privacy, rendered workflow, doctor, CI, dogfood, smoke, E2E, and release validation.
