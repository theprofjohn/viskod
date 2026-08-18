# RFC-0001: UI Issue to Verified Fix as the First Product Workflow

Status: **Accepted**

Authors: Viskod product/engineering

Date: 2026-08-05

---

# Summary

Make "report a UI issue by pointing at the element, hand it to a coding agent,
and verify the rendered result" the first complete end-user workflow of Viskod.
Studio becomes the human surface that walks a user through **Report → Prepare
agent handoff → Verify fix**, while MCP tools, selectors, packet data, and IDs
remain backend/agent details.

# Motivation

Viskod already exposes a technically capable capture and MCP workflow, but its
primary human surface is not understandable:

- `apps/studio/src/index.ts` is a JSON/WebSocket backend with inspection-oriented
  panels and no browser UI.
- `AGENT_WORKFLOW.md` teaches users and agents to think in selectors, packets,
  handoff IDs, and recapture flags.
- The repository already contains reusable user-facing services
  (`VisualSelectionServiceImpl` + `SelectionOverlayController`,
  `IssueServiceImpl`, `UserFacingHandoff`, `UserFacingReview`), but Studio does
  not wire them into one coherent path.

The result: a developer cannot start from a broken UI and reach a verified fix
without learning internal machinery that should stay invisible.

# Background

- Studio is the human interface; the MCP server is the machine interface
  (MEMORY.md Decision 002). Neither is optional.
- Viskod observes; AI coding agents implement (MEMORY.md Decision 001).
- Local-first (Phase 1) and honest results ("return confidence, never invent
  certainty") are established product principles.
- The MCP server exposes `create_agent_handoff`, `create_visual_review`, and
  `recapture_visual_review`. Studio does not invoke an external coding agent;
  it prepares a handoff the connected agent can consume.

# Proposal

## The workflow

1. **Report UI issue** — user opens a local app in Studio, clicks
   `Report UI issue`, hovers over the problem and clicks it.
2. **Describe** — Studio shows a redacted summary of the selected element;
   user fills in `What is wrong?` and `What should happen?` plus severity.
3. **Prepare agent handoff** — Studio creates an issue + handoff and shows
   `Handoff ready` with a copyable agent prompt/ID. It does not claim to
   invoke an external coding agent.
4. **Verify fix** — user refreshes Studio verification (reload + cache-bust),
   sees before/after evidence with plain-language status, and decides
   `Accept fix`, `Issue persists`, or `Needs follow-up`.

## Product boundaries

- **Pointing at the element** replaces manual selector discovery as the
  normal user path. Selectors are internal recapture locators, never the
  primary UI label.
- **A changed screenshot is evidence, not truth.** The UI never auto-accepts on
  pixel change; `changed` renders as "The rendered result changed; review
  whether it matches the expected result".
- **Capture is supporting infrastructure** for this workflow, not the
  user-visible product outcome. The broader visual-context vision remains the
  long-term direction (Phase 2+).
- **Human review boundary**: the human records the final decision
  (`accepted` / `rejected` / `needs_follow_up`).

## Implementation notes

- New `StudioWorkflow` orchestrator in `apps/studio/src/workflow.ts` with
  explicit stages: `idle → selecting → describe → handoff_ready →
  verifying → review_ready → decided`.
- Optional `selector` on `VisualSelectionTarget` (internal recapture locator),
  generated in page context with preference for stable attributes
  (`data-testid`, `data-test-id`, `id`, `aria-label`, `name`) and a bounded
  `:nth-of-type` ancestor path fallback; no selector when a safe unique
  locator cannot be produced.
- Optional `evidence` metadata appended to `IssueService.createIssue`
  (positional, trailing; existing callers unchanged).
- Framework-free Studio HTML (`renderStudioHtml()`) with exactly three primary
  screens; technical evidence only in a collapsed "Evidence details" section.
- Handoff input extended to carry source-hint list/status and context
  inclusion flags; persisted issue evidence populates the handoff context
  (`evidenceSummary`, `packetRefs`).

# Alternatives

## Generic browser inspection as the product promise

- Advantages: broad inspection already works; no new UX design needed.
- Disadvantages: inspection panels do not complete a user job; a developer
  with a broken UI still has to assemble selector → packet → agent manually.
- Rejected because: it treats infrastructure as the outcome.

## Full in-Studio agent invocation (Studio drives a coding agent)

- Advantages: one surface from report to fix.
- Disadvantages: duplicates existing coding agents; the current MCP
  integration only makes a handoff available to the connected agent; would
  violate MEMORY.md Decision 001.
- Rejected for this phase. Studio says `Prepare agent handoff` and gives the
  user a copyable handoff for their coding agent.

## Selector-first workflow with a schema migration for expected result

- Advantages: no description parsing needed.
- Disadvantages: a VisualIssue persistence migration for one field is
  disproportionate; the existing `description` already survives persistence.
- Rejected for this phase. The exact format
  `Problem:\n<problem>\n\nExpected result:\n<expected>` is stored in
  `description`; no schema migration.

# Compatibility

- Existing MCP tools (`viskod_*`, `create_agent_handoff`,
  `create_visual_review`, `recapture_visual_review`, setup tools) are
  unchanged; agent integrations can keep using the technical call sequence.
- Existing Studio HTTP endpoints (`/state`, `/navigate`, `/select/*`,
  `/capture`, `/packet/latest`, chat, settings, overlay, MCP config) remain.
- `VisualSelectionTarget` gains an optional field; schemas remain backward
  compatible.
- `IssueService.createIssue` gains an optional trailing positional parameter;
  existing callers are unaffected.
- The e2e fixture (`examples/phase12-source-hint-app`) is reused; the smoke
  script now starts/stops its own fixture server instead of assuming one is
  running.

# Migration

- `AGENT_WORKFLOW.md`, `QUICKSTART_MCP.md`, `README.md`, and
  `examples/agent-workflows/viskod.workflow.json` lead with the human flow
  ("Point at problem", "What is wrong?", "What should happen?", "Prepare
  agent handoff", "Verify fix") and keep the exact MCP tool names and call
  order as an advanced technical section.
- Wording implying users should manually discover selectors as the normal
  path is removed.

# Risks

- **Overlay selector quality**: a fragile selector would break recapture.
  Mitigation: only stable-attribute-first selectors are produced, uniqueness
  is verified in page context, and capture failure keeps the workflow at the
  current stage with a recovery message instead of creating a partial issue.
- **False verification confidence**: a changed screenshot does not mean the
  fix is correct. Mitigation: comparison status is treated as evidence with
  plain-language messaging; the human always decides.
- **Scope creep toward an IDE**: Studio stays a workflow surface; editing,
  chat, and agent execution remain outside.

# Open Questions

- None blocking. Follow-ups: multiple issues per page, issue list UI,
  automatic agent-launch integration behind a verified API.

# Decision

Accepted. "UI issue to verified fix" is the first product workflow. Capture,
selection, and packets become supporting infrastructure behind the
Report → Prepare agent handoff → Verify fix path, with the human as the final
reviewer.

# References

- `docs/studio.md` — Studio specification (updated: Report/Prepare/Verify)
- `docs/product.md` — product strategy (updated ICP/Phase 1 language)
- `AGENT_WORKFLOW.md` — human flow + technical MCP section
- `examples/agent-workflows/viskod.workflow.json` — workflow JSON
- `MEMORY.md` — decision log
