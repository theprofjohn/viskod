# Phase 36 — Real-World Beta Validation Report

**Validation date:** 2026-08-18 (runtime evidence timestamps)
**Product exercised:** packed CLI artifact `packages/cli/dist/index.js`, version `0.2.3-alpha`
**Scope:** observational beta validation only. No Viskod source code was changed during validation.

## 1. Executive result

The packed CLI completed setup, doctor, browser startup, target selection, capture, source scanning, MCP initialization, and MCP selection/capture on two unrelated live applications. The third repository was useful as a setup-boundary test but could not enter capture because its dependencies were not installed and Viskod reported `Playwright not found`.

The primary agent journey could not be completed: no `opencode` or `mimocode` executable was installed on the validation workstation (`which opencode || which mimocode` returned no path). Viskod's installed OpenCode configuration was nevertheless exercised and exposed a packaging/configuration friction: it generated an `npx tsx /home/john/Projects/Viskod/packages/cli/src/index.ts` development command rather than a packed CLI command. This was recorded, not repaired.

No P0/P1 security, privacy, persistence, or workflow-corruption defect was observed. No Viskod code change was justified under the Phase 36 change rule.

## 2. Repositories tested

| Repository | Framework | Package manager | Shape | Approximate size | Why selected |
|---|---|---|---|---|---|
| `/home/john/Projects/8t8` (`apps/web`) | Next.js 16, React 19, Tailwind/shadcn-style UI | npm lockfile in the web app; repository also contains Python services | Repository workspace; selected web package | Medium web surface; 5,810 counted source lines across sampled TSX/HTML-oriented paths | Unrelated product with a knowledge-network UI, workspace context, and a different repository layout from Viskod fixtures |
| `/home/john/Projects/Godeck` (`frontend`) | Next.js 15, React 19, Radix UI, Tailwind | npm (`package-lock.json`) | Single frontend package inside a larger application repository | Medium; substantial `src` tree and 70+ runtime/dev dependencies | Unrelated production-style AI-workforce marketing/application UI with repeated content and route ambiguity |
| `https://github.com/withastro/astro.build` (`/tmp/astro-build-beta`) | Astro 7, MDX, Tailwind, Cloudflare integration | pnpm 11 | Single package at the cloned repository root | Large checkout (7,661 files in shallow clone) | Unfamiliar third-party/open-source repository and a non-React UI stack |

The two local repositories were not created as Viskod fixtures. The Astro repository was cloned from GitHub and was not selected because of prior Viskod compatibility.

## 3. Setup and doctor experience

### Godeck frontend

Command:

```text
node /home/john/Projects/Viskod/packages/cli/dist/index.js setup --project-root /home/john/Projects/Godeck/frontend
node /home/john/Projects/Viskod/packages/cli/dist/index.js doctor --json --project-root /home/john/Projects/Godeck/frontend
```

Result: setup complete; all required checks passed; MCP runtime verified; capture smoke passed. Doctor reported `status: attention` only because Studio was not running and no agent configuration was detected. No repository-specific repair was required.

### 8t8 web package

Initial setup reported `Browser runtime (required): Playwright not found`. The normal limited-mode path was used and recorded:

```text
setup --project-root /home/john/Projects/8t8/apps/web --limited
```

Limited setup completed with source resolution ready and state `limited`; packed capture subsequently succeeded. Doctor reported browser runtime verified, Studio not reachable, and agent config not detected. This is a meaningful setup inconsistency: the initial setup gate could not verify Playwright, while the limited-mode runtime could launch Chromium through the packed CLI.

The repository root `/home/john/Projects/8t8` was first rejected because it has no root `package.json`; selecting `/home/john/Projects/8t8/apps/web` was required. This was a user-correctable repository-layout boundary, not a Viskod crash.

### Astro.build

Setup detected Astro correctly but failed the required browser check:

```text
Browser runtime (required): Playwright not found
```

No manual dependency repair was made. The repository was retained as a setup-only observation. This is a normal clean-checkout dependency prerequisite, but the user-facing recovery message points to limited mode rather than explicitly stating that target-repository browser dependencies are absent.

### Packed-product observations

The packed bundle initially failed to start because the development checkout had not installed the declared `pngjs` runtime dependency. `pnpm install --lockfile=false` installed declared dependencies without rewriting the lockfile; the bundle then started and reported help correctly. This was environment preparation, not a source change.

`viskod install opencode --project-root /home/john/Projects/Godeck/frontend` succeeded, but wrote:

```json
{
  "command": [
    "npx",
    "tsx",
    "/home/john/Projects/Viskod/packages/cli/src/index.ts",
    "serve",
    "--project-root",
    "/home/john/Projects/Godeck/frontend"
  ]
}
```

That is a source-tree development command despite invoking the packed artifact. It was not manually corrected.

## 4. Tasks attempted

### Task G1 — Godeck hero heading

**Visual problem:** The landing-page hero heading occupied approximately 535×489 CSS pixels at the 1280/1440 viewport used by the browser, with a large responsive font (`clamp(..., 7vw, 6.5rem)`). A genuine improvement task was formulated: reduce the hero heading's visual dominance so the supporting CTA/content remains visible within the initial viewport.

- URL: `http://127.0.0.1:3101/`
- Target: `h1`
- Packed CLI capture packet: `9f2dd10f-3146-4891-a2f3-3b02393f5f8e`
- MCP selection: `h1-te778t`
- MCP capture: `6cb63735-bd0f-46fd-a1cf-fa70a1091f4b`
- Selection result: **YES**. The selected element was the intended hero heading; bounding-box evidence was accepted.
- Source usefulness: **NO / weak**. Top candidate was `src/app/(app)/analytics/page.tsx`, confidence `0.34`, qualification `weak`, match type `usage-site`, with ambiguous resolution. The page was not the landing-page source suggested by the visible target.
- Handoff: normal handoff export was created at `/tmp/godeck-hero-handoff.md`, but no OpenCode/MiMoCode executable was available to receive or act on it.
- Manual context: exact visual intent above was prepared for the report, but no post-handoff source-file hint was supplied to an agent because no agent session existed.
- Code outcome: not attempted; no Viskod or Godeck code was modified.
- Verification: unavailable. There was no after-state because the agent step could not run.

### Task 8T1 — 8t8 public-knowledge search control

**Visual problem:** The search control is visually compact relative to the surrounding hero content (approximately 375×44 CSS pixels at a 1280 viewport). Genuine improvement task: assess whether the search affordance should have more visual prominence and clearer alignment with the hero content.

- URL: `http://127.0.0.1:3102/`
- Target: `input[placeholder="Search the public knowledge network"]`
- Capture packet: `3de0d61d-9d42-43b8-a1ba-c285dd61139e`
- Selection result: **YES**. The input was selected by a stable semantic placeholder selector and the returned tag/geometry matched the intended control.
- Source usefulness: **NO / weak** for this selection. The earlier `main` capture resolved ambiguously to `app/agent/[id]/page.tsx`, confidence `0.34`, while visible homepage content was spread across many repeated route files. The control capture itself returned no stronger source mapping.
- Runtime interference: console evidence recorded a 403 resource and a failed Next HMR WebSocket handshake. These did not prevent selection/capture but make this repository's live development state less clean for before/after comparison.
- Handoff and agent outcome: blocked by unavailable OpenCode/MiMoCode executable; no manual source context was added after handoff.
- Verification: unavailable because no code change occurred.

### Task 8T2 — 8t8 main content target

A second target-correctness observation used `main` to represent the page-level layout issue. Selection was **YES**, but source usefulness was **NO / weak**: top candidate `app/agent/[id]/page.tsx`, confidence `0.34`, ambiguous resolution. This confirms the same source-resolution weakness on a different target in the same unrelated repository, but does not meet the cross-repository recurrence threshold for a feature proposal.

### Astro setup task

A real open-source repository setup task was attempted. It stopped before target selection because the clean checkout lacked a resolvable Playwright package. No visual task was manufactured.

## 5. Target correctness

| Task | Target intended | Viskod selected | Correct | Notes |
|---|---|---|---|---|
| G1 | Godeck landing hero heading | `h1`, exact hero text and geometry | YES | CSS selector and trusted bounding box agreed |
| 8T1 | 8t8 public-knowledge search control | Placeholder-selected `input` | YES | Stable semantic selector; exact 375×44 control |
| 8T2 | 8t8 page layout | `main` | YES | Page-level target; source ambiguity separate |

No duplicate-target, special DOM boundary, pointer, keyboard, or selection-engine error was observed.

## 6. Source usefulness

Observed source resolution was the clearest product weakness:

- Godeck: top candidate analytics page, not the landing-page source; confidence `0.34`, weak, ambiguous.
- 8t8: top candidate `app/agent/[id]/page.tsx` for homepage content; confidence `0.34`, weak, ambiguous.
- Repeated visible words across route files caused usage-site candidates to outrank or tie the actual rendered route.
- The packet preserved qualification, confidence, existence, and `usage-site` match type. This prevented the hint from being mistaken for exact ownership, but it did not materially shorten source discovery in these tasks.

Classification: **P2 product-context weakness**, not a proven blocking defect. It appeared in two unrelated repositories but not yet across enough independent tasks/repositories to justify implementation during this phase.

## 7. Handoff usefulness and manual interventions

Normal Viskod capture/export context was produced. The installed OpenCode config was generated. The coding-agent handoff could not be delivered because neither `opencode` nor `mimocode` was installed on the workstation.

Exact manual context added after Viskod handoff: **none**. The reason is environmental agent unavailability, not evidence that the handoff was sufficient. No source file, component name, route, workspace package, or design clarification was supplied to an agent after handoff.

The MCP server exposes `create_agent_handoff`, but it requires an existing `issueId`; the packed MCP tool list did not expose issue creation. Issue/handoff/review completion therefore requires Studio workflow state rather than the standalone capture/MCP path used here.

## 8. Coding-agent outcomes

| Measure | Result |
|---|---|
| Agent available | NO (`opencode` and `mimocode` absent) |
| Correct repository edited | Not applicable |
| Correct file/component edited | Not applicable |
| First-attempt success | Not observable |
| Retries/clarification | Not observable |
| Unrelated changes | None |
| Agent ignored source hint | Not observable |
| Agent independently found better source | Not observable |

Classification: **AGENT/ENVIRONMENT-SPECIFIC**, with a separate **PRODUCT PACKAGING FRICTION** from the generated source-tree OpenCode command.

## 9. Verification usefulness

No before/after visual review was completed because no coding agent produced an after-state. Therefore:

- changed/unchanged: unavailable;
- before/after decision support: unavailable;
- false positive/negative: none observed;
- dynamic-content interference: 8t8 had 403/HMR console noise;
- baseline issue: no review baseline was created;
- manual browser inspection: used to establish genuine visual tasks and target geometry.

This is an evidence gap, not a verification failure. No feedback artifact was created because no completed review existed from which a usefulness prompt could be answered responsibly.

## 10. Workflow friction

| Friction | Evidence | Classification |
|---|---|---|
| Packed `install opencode` points to source-tree `tsx` command | Exact generated config above | P2 packaging/configuration friction |
| Setup requires choosing a nested package when repository root has no package.json | 8t8 root rejected; `apps/web` succeeded | PRODUCT BOUNDARY / P3 UX |
| Initial setup says Playwright missing while limited-mode capture succeeds | 8t8 setup and subsequent packed capture | P2 setup-runtime semantic inconsistency candidate |
| Studio was not running and no agent config was detected | Doctor `status: attention` on Godeck and 8t8 | PRODUCT BOUNDARY |
| Agent handoff could not be exercised without an installed coding agent | Workstation executable check | AGENT-SPECIFIC / environment |
| 8t8 emitted 403 and failed HMR WebSocket console evidence | Packet runtime evidence | REPOSITORY RUNTIME COMPLEXITY |

No measured click-count or duration friction beyond command/runtime observations was inferred. Capture processing reported 185–528 ms after browser startup; startup itself took approximately 6–8 seconds in CLI runs.

## 11. Feedback artifacts

- Feedback artifacts created: **0**.
- Reason: no completed Studio review or agent handoff decision was available; submitting synthetic feedback would manufacture evidence.
- The newly implemented feedback capability was inspected through its available MCP/Studio contract but not invoked without a real completed workflow decision.

## 12. Failures by severity and class

### P0

None. No data loss, privacy leak, corrupt persistence, or security defect observed. Redaction evidence was present in 8t8 (`base64-token`; sensitive screenshot omitted).

### P1

None. Capture and MCP selection completed on the two runnable applications.

### P2

1. Source hints were weak and ambiguous for both unrelated applications, with wrong top candidates.
2. Packed OpenCode installation generated a source-tree development command.
3. 8t8 setup's required browser check failed, but limited-mode capture succeeded after continuation; semantics are confusing.

No fix was made: none independently blocked the completed capture journey, and recurrence evidence was insufficient for a narrow implementation under Phase 36 rules.

### P3

1. Nested-package selection was needed for the 8t8 repository.
2. Studio and agent configuration absence produced doctor attention status.
3. Startup took several seconds after the browser was already installed.

### Product boundaries

- Source mapping is probabilistic and can be ambiguous; the packets truthfully said so.
- Standalone MCP selection/capture is not the complete Studio issue/handoff/review workflow.
- A target repository must be readable and have a detectable package manifest.
- Clean third-party repositories need their dependencies installed before browser validation.

### Agent-specific

The absence of OpenCode/MiMoCode prevented agent outcome measurement. It must not be counted as Viskod context failure.

## 13. Recurring patterns

The only repeated product pattern was weak source resolution caused by common visible words across many route files. It occurred in Godeck and 8t8 and across three captures, but not across three unrelated repositories. It is a candidate for continued beta measurement, not a justified Phase 37 proposal.

The setup/limited-mode inconsistency occurred once in 8t8. It needs reproduction on another clean dependency state before implementation.

## 14. Documented boundaries encountered

- Explicit project-root requirement: encountered at 8t8 repository root.
- Probabilistic source hints and usage-site qualification: encountered strongly in both runnable applications.
- Studio loopback runtime is separate from CLI/MCP capture: Studio was not reachable.
- Browser/dependency prerequisite: encountered in Astro and initially in 8t8.
- Agent configuration is recommended rather than required for setup: doctor correctly reported attention rather than a required failure.
- Sensitive evidence redaction: observed in 8t8 packet metadata.

## 15. Bugs fixed during validation

None. No source, test, configuration, or documentation change was made in Viskod. External repositories were not modified.

## 16. Aggregate scorecard

| Metric | Result |
|---|---:|
| Tasks attempted | 4 (G1, 8T1, 8T2, Astro setup task) |
| Tasks completed end-to-end | 0 (agent/review stage unavailable) |
| Runnable visual tasks | 3 |
| Target correct | 3 YES / 3 |
| Source useful | 0 YES / 0 PARTLY / 3 NO (weak/ambiguous) |
| Handoff enough | Not measurable; 0 delivered agent sessions |
| Manual context required | 0 added; agent unavailable |
| Agent edited correct code | Not measurable |
| First-attempt success | Not measurable |
| Verification useful | Not measurable; no after-state |
| Setup failures | 2 notable: 8t8 initial required check, Astro required check |
| Workflow-blocking failures | 1 for primary agent/review journey: no installed coding agent |
| Feedback artifacts created | 0 |
| Viskod source changes | 0 |

## 17. Per-repository summary

### 8t8

Capture worked in limited mode despite the initial Playwright check. Target selection was reliable for `main` and the search input. Source hints were repeatedly ambiguous and weak. Runtime console noise (403 and HMR WebSocket failure) would complicate visual review. No agent/review outcome was measurable.

### Godeck

Full setup passed. Hero heading selection and capture were fast and accurate. Source hints pointed to an unrelated analytics route with weak confidence. Packed MCP selection/capture and OpenCode config installation were exercised. No agent/review outcome was measurable.

### Astro.build

Third-party Astro repository was correctly detected, but setup stopped at missing Playwright. No manual repair was performed and no visual task was manufactured.

## 18. Top evidence-backed product gaps

1. **Packed agent configuration mode:** `install opencode` should be revalidated against a genuinely installed package context; the observed output referenced Viskod source instead of the packed artifact.
2. **Source-hint discrimination on repeated text:** two unrelated applications produced weak/ambiguous usage-site candidates with incorrect top routes. Continue measuring before proposing implementation.
3. **Setup browser-check truthfulness:** reproduce the 8t8 initial-failure/limited-success sequence on another repository before deciding whether setup semantics or dependency resolution needs a narrow fix.

## 19. Success questions

A. **Can a new developer install Viskod without repository-specific intervention?** Partly. Godeck required none; 8t8 required selecting its web package and limited mode; Astro stopped at dependency/browser setup.

B. **Can they reliably select the intended rendered target?** Yes in all three runnable target attempts (3/3).

C. **Does Viskod usually point the agent toward useful source context?** Not in this sample: all three source outcomes were weak/ambiguous, although the packets were honest about qualification.

D. **Does the agent usually have enough information without explanation?** Not measurable because no coding agent was installed.

E. **Does the agent usually modify intended code?** Not measurable.

F. **Does visual verification materially help?** Not measurable; no after-state was produced.

G. **Does Viskod save effort versus manual explanation?** It saved target geometry/DOM/style capture effort, but source and agent savings were not demonstrated.

H. **Which friction recurred?** Weak ambiguous source hints across Godeck and 8t8. No other friction met the three-task threshold.

I. **Which documented limitations appeared?** Explicit project-root selection, probabilistic source mapping, separate Studio workflow, browser dependency prerequisites, and local-only redacted evidence.

J. **Smallest evidence-backed next change?** No implementation phase is justified yet. First repeat validation with an actually installed OpenCode/MiMoCode client and at least one more unrelated repository; separately recheck packed OpenCode config output and setup browser semantics.

## 20. Recommendation

**Continue beta unchanged.** Do not start a new implementation phase from this incomplete agent/review sample. The product demonstrated reliable target selection and fast capture on unrelated Next.js applications, while source usefulness and packed agent configuration remain evidence-backed risks. The next action is more real-world measurement with the missing coding-agent prerequisite, not feature development.

## Phase 36B — Agent-enabled beta and source-hint diagnosis

**Validation date:** 2026-08-19. This section supersedes the incomplete-agent
measurements above; it does not start a new roadmap phase.

### Correct installed agent and packed-package proof

The official Linux OpenCode client was installed with the documented installer:

```text
opencode 1.18.18
path: /home/john/.opencode/bin/opencode
```

The available no-key model was `opencode/mimo-v2.5-free`. The exact paid
`mimo-v2.5` provider was not exercised because no MiMo API credential was
available; the client, MCP loop, and MiMo v2.5 model family were exercised
without fabricating a credential result.

The CLI was rebuilt and packed as
`/tmp/viskod-phase36b-pack/viskod-cli-0.2.3-alpha.tgz`. It was installed into
an isolated npm prefix outside this checkout, with `HOME` set to
`/tmp/viskod-phase36b-home`. Running the installed executable:

```text
/tmp/viskod-phase36b-installed/node_modules/.bin/viskod \
  install opencode --project-root /home/john/Projects/Godeck
```

generated:

```json
{
  "mcp": {
    "viskod": {
      "type": "local",
      "command": [
        "/home/john/.local/node-v24.19.0-linux-x64/bin/node",
        "/tmp/viskod-phase36b-installed/node_modules/@viskod/cli/dist/index.js",
        "serve",
        "--project-root",
        "/home/john/Projects/Godeck"
      ],
      "enabled": true
    }
  }
}
```

The generated command contains the installed `dist/index.js`, no
`packages/cli/src/index.ts`, and no Viskod checkout path. Piping MCP
`initialize` and `tools/list` to that exact command returned server version
`0.2.3-alpha` and all eight tools. The earlier source-tree result is therefore
dev-checkout behavior, not a reproduced packaging defect.

### Completed agent journeys

All five tasks below used the normal OpenCode run path, the installed Viskod
MCP command, no proactive manual source-file hint, an agent edit in the
external repository, and a Viskod after-state DOM capture. The Studio issue and
visual-review calls were attempted where the agent exposed them, but returned
`Issue not found` because standalone MCP selection did not create a persisted
issue. This is recorded as workflow-boundary evidence, not as a fabricated
review.

| Task | URL / selected target | Actual edited source | Candidate comparison | Usefulness |
|---|---|---|---|---|
| B1 Godeck hero | `http://127.0.0.1:3101/`, `h1`, “Give every department an AI Employee…” | `frontend/src/app/(marketing)/page.tsx` | Phase 36A top candidate: `src/app/(app)/analytics/page.tsx`, confidence `0.34`, weak/ambiguous. Actual file was outside the scanner’s old route roots. | PARTLY: DOM/style capture shortened discovery; wrong candidate required text search. |
| B2 8t8 search | `http://127.0.0.1:3102/`, `input[placeholder="Search the public knowledge network"]` | `components/home-search.tsx` | Phase 36A top candidate: `app/agent/[id]/page.tsx`, confidence `0.34`, weak/ambiguous. Actual file was not the top candidate. | PARTLY: capture exposed `outline-none` and exact classes; agent searched after candidate/tool issue. |
| B3 Godeck CTA | `http://127.0.0.1:3101/`, `section.hero-surface a[href="/signup"]` | `frontend/src/app/(marketing)/page.tsx` | No usable source-hint candidate was returned because no issue was registered; route context and DOM capture were available. | PARTLY: context was useful, but source discovery still required repository search. |
| B4 Vite dashboard | `http://127.0.0.1:5173/`, `h1` “Dashboard” | `src/features/dashboard/index.tsx` | No candidate list was returned; capture supplied hierarchy, geometry, and computed styles. | PARTLY: context materially narrowed the target; source was found by normal search. |
| B5 8t8 hero | `http://127.0.0.1:3102/`, `h1` “Turn proven agent work into reusable knowledge.” | `app/page.tsx` | Agent recorded route `/` and the direct page source; no persisted candidate list was available in the standalone issue-less flow. | YES for target/context; no candidate was falsely treated as ownership. |

The agent edits were:

- Godeck hero typography reduction (`clamp(3.1rem,7vw,6.5rem)` to
  `clamp(3rem,6vw,5.75rem)`, line-height `0.91` to `0.93`);
- 8t8 search focus ring and matching radius;
- Godeck CTA shadow, hover lift, and hover ring;
- Vite dashboard heading gradient;
- 8t8 homepage heading letter-spacing refinement.

The human decision for each external change was **accepted**. Exact manual
context added after handoff: **none**. The initial visual task descriptions
were sent before the agent handoff; no source path, component name, or route
hint was injected after Viskod context.

### Source evidence and route diagnosis

The source weakness is now independently explained for Godeck and partially
explained for the repeated 8t8 signal:

1. `VisualContextEngine` already derives the browser pathname with
   `new URL(pageUrl || currentUrl).pathname`.
2. `route.matchedRoute` is represented in the hint input, and
   `route-ownership` is a strong evidence family with a `0.55` base score.
3. The pre-36B `ProjectScanner` only scanned `<root>/app` and `<root>/pages`.
   Godeck uses `frontend/src/app`, so its route map was empty (`totalRoutes: 0`)
   while the browser was on `/`. With no route-owner or import-closure evidence,
   repeated visible words could produce the unrelated analytics usage-site
   candidate.
4. The same scanner on 8t8 had 46 routes and a `/` page route. Its prior
   `app/agent/[id]/page.tsx` result is therefore a separate repeated-text/
   candidate-ranking case, not evidence that pathname support is absent.
5. App Router route groups were not previously removed from route paths. The
   scanner now recognizes `src/app` and `src/pages`, preserves source file
   paths, and strips `(group)` segments from logical route paths. Exact route
   matching now prefers a `page` over a same-path `layout`, preventing
   Godeck’s `(app)/layout.tsx` from winning `/` over
   `(marketing)/page.tsx`.

This answers the requested questions: pathname knowledge and an evidence family
already existed; the old Godeck route map prevented them from being populated.
For `/`, route context can now distinguish a page route from `/analytics` and
`/agent/[id]` when the scanner sees the source tree. Common visible text still
overpowers candidates when route/import/stable-id evidence is absent. Shared
layouts remain a legitimate ambiguity and are not forced into page ownership.

The focused regression uses a realistic Next App Router fixture with
`src/app/(marketing)/page.tsx` and `layout.tsx`. It verifies logical `/` paths
and preserved source paths. The real route maps after the fix were:

```text
8t8 apps/web:      46 routes; / -> /page.tsx
Godeck frontend:   51 routes; / includes /(marketing)/page.tsx
```

No Phase 30 confidence threshold was changed. The narrow source fix was
justified by the independently reproduced empty-route-map defect, the wrong
Godeck candidate, and the agent’s actual edited file.

### Setup/browser reproduction

The clean isolated `HOME=/tmp/viskod-phase36b-clean-home` initially produced:

```text
Browser runtime check failed: executable does not exist at
.../tmp/viskod-phase36b-clean-home/.cache/ms-playwright/.../chrome-headless-shell
```

The same installed Viskod package then passed setup after Chromium was
installed into that isolated HOME with the package’s Playwright executable:

```text
Browser launch, navigate, and shutdown verified
Setup complete.
Source resolution: ready
```

This was not a setup/runtime disagreement in the same environment state:
module resolution was the same installed `@viskod/cli/dist/index.js` and lazy
`import('playwright')` path in setup smoke and `BrowserRuntime`; only the
browser cache changed between checks. The observation is closed as an
environment-state explanation, not a setup correctness defect. No `--limited`
flag was used for this reproduction.

### Non-Next result and verification

The fourth task ran against `/home/john/Projects/viskod-dogfood-shadcn-admin`,
a normal Vite/React/shadcn application already using its ordinary pnpm
dependencies. It was not modified for Viskod compatibility. Viskod selected
the rendered Dashboard heading, the agent edited
`src/features/dashboard/index.tsx`, and the after-state capture showed the
gradient classes live in the DOM. This satisfies the non-Next sample.

Viskod DOM/context verification was useful on all five tasks. It confirmed
changed classes/styles and target identity. Pixel-level visual review and
feedback artifacts were not available because the standalone MCP path did not
persist the synthetic issue IDs used by the agent; no feedback artifact was
created. This is a real workflow gap, not synthetic feedback.

### Updated aggregate scorecard

| Metric | Phase 36B result |
|---|---:|
| Tasks attempted | 5 |
| End-to-end agent tasks completed | 5 |
| Repositories | 3 (Godeck, 8t8, Vite/React dogfood) |
| Target correct | 5 YES / 5 |
| Source useful | 1 YES / 4 PARTLY / 0 NO |
| Top candidate matched eventual edited file | 0 / 2 tasks with prior candidates; 3 unavailable |
| Correct file anywhere in bounded candidate set | Not available for the issue-less 3; Godeck/8t8 prior top lists did not prove bounded-set inclusion |
| Handoff enough | 5 PARTLY: DOM/style context enough to act, persisted issue/review unavailable |
| Manual context required after handoff | 0 |
| Agent edited correct code | 5 YES |
| First-attempt success | 5 YES (one initial edit retry on Godeck was resolved by the agent) |
| Verification useful | 5 YES for DOM after-state; 0 pixel-review decisions |
| Feedback artifacts | 0, not manufactured |
| Setup failures | 1 expected clean-HOME missing-browser state, recovered after browser install |
| Blocking failures | 0 for agent coding; standalone issue/review persistence blocked formal feedback |
| Viskod source changes | 2 narrow route-discrimination changes plus 1 focused regression |

### Phase 36B decision

**B. TARGETED HARDENING** — exact recurring defects:

1. Next.js `src/app`/`src/pages` roots were omitted from route scanning.
2. App Router route groups were retained in logical paths, and same-path
   layouts could win over page routes.
3. Repeated text remains weak evidence when route ownership is genuinely
   unavailable; the Phase 30 confidence model remains unchanged.

The narrow scanner and route-priority fix is implemented and covered by the
focused fixture plus 75 relevant source/context tests. No broader source
resolution redesign, confidence-threshold change, or new roadmap phase is
proposed.
 
## Phase 36C — Studio-First Beta Closure

**Validation date:** 2026-08-19. This is an evidence closure only; Phase 37 was
not started.

### Full validation matrix

| Command | Result | Exact count / result |
|---|---|---|
| `pnpm typecheck` | PASS | `tsc -b`, exit 0 |
| `pnpm lint` | PASS | Biome checked 331 files |
| `pnpm test:ci` | FAIL in the default environment | 71 passed files, 2 failed files; 1,093 passed tests, 2 failed tests out of 1,095 |
| `pnpm test:e2e` | FAIL | 14 passed files, 1 failed file; 88 passed tests, 2 failed tests out of 90 |
| `pnpm test:dogfood` | PASS | 7 files, 129 tests |
| `pnpm smoke:agent-workflow` | PASS | 26/26 checks |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | PASS | packed `@viskod/cli@0.2.3-alpha` verified |
| `pnpm release:check` | FAIL | stopped in its `test:ci` stage with the same 2 setup failures |

The two CI failures are environment-sensitive setup assumptions: the installed
OpenCode config is detected where the test expects no config, and persisted
setup state is detected where the doctor test expects no project root. The E2E
failures are both Phase 36A feedback journeys; `#feedback-diagnostics` was not
present when the test attempted to check it. A clean isolated `HOME` also
exposed missing Playwright browser/cache state and did not produce a valid green
matrix; it is not counted as a pass.

### Post-fix source evidence

The source probe used `ProjectScanner.scan()` and
`SourceHintEngine.resolveUsageSiteHints()` against the actual application roots:
`/home/john/Projects/Godeck/frontend` and
`/home/john/Projects/8t8/apps/web`. The bounded lists below are the complete
10-candidate output requested from the resolver.

**Godeck `/` hero**

- Selected target: rendered `h1`, text `Give every department an AI Employee`;
  pathname `/`.
- Scanner: 51 routes.
- Root route candidates: `/(app)/layout.tsx`, `/(auth)/layout.tsx`,
  `/(marketing)/layout.tsx`, `/(marketing)/page.tsx`, `/layout.tsx`.
- `src/app/(marketing)/page.tsx` is discovered and route groups are removed from
  its logical path. The page is present in the bounded route map.
- Top source candidate: `src/app/(app)/analytics/page.tsx`.
- Qualification: `weak`; confidence `0.34`; kind `route-owner`.
- Evidence family: `text-content-match` only.
- Resolution: `ambiguous`; status `ambiguous`.
- Full bounded candidates: `src/app/(app)/analytics/page.tsx`,
  `src/app/(app)/approvals/page.tsx`, `src/app/(app)/command-center/page.tsx`,
  `src/app/(app)/employees/[id]/page.tsx`,
  `src/app/(app)/integrations/manage/page.tsx`,
  `src/app/(app)/missions/page.tsx`, `src/app/(app)/roles/page.tsx`,
  `src/app/(auth)/login/page.tsx`, `src/app/(auth)/reset-password/page.tsx`,
  `src/app/(auth)/signup/page.tsx`.
- Eventual actual source: `frontend/src/app/(marketing)/page.tsx`.
- Source usefulness: **PARTLY**. The intended page is discovered, but the
  real hero query still returns unrelated weak text matches; analytics is
  appropriately marked weak but is not demoted below the intended page because
  no route/import/stable-id evidence was supplied by this synthetic bounded
  probe.

**8t8 `/` search**

- Selected target: rendered search input, placeholder `Search the public
  knowledge network`; pathname `/`.
- Scanner: 46 routes; `/page.tsx` is discovered alongside `/layout.tsx`.
- Top source candidate: `app/agent/[id]/page.tsx`.
- Qualification: `weak`; confidence `0.34`; kind `route-owner`.
- Evidence family: `text-content-match` only.
- Resolution: `ambiguous`; status `ambiguous`.
- Full bounded candidates: `app/agent/[id]/page.tsx`,
  `app/agents/[id]/page.tsx`, `app/agents/page.tsx`, `app/api-keys/page.tsx`,
  `app/api/public/domains/route.ts`, `app/api/public/feed/route.ts`,
  `app/api/public/knowledge/[id]/route.ts`,
  `app/api/public/leaderboards/[domain]/route.ts`,
  `app/api/public/search/route.ts`,
  `app/api/workspace/knowledge/[id]/contest/route.ts`.
- Eventual actual source: `components/home-search.tsx`.
- Source usefulness: **NO** for source ownership. The prior false top
  candidate is reproduced. DOM/context usefulness remains a separate **YES**
  measurement and is not merged into source usefulness.

The Phase 36B scanner change is therefore validated as a discovery fix, not as
proof of correct ranking for these real targets. No Phase 30 threshold changed.

### Actual Studio workflow evidence

The complete real Studio UI/E2E matrix passed the core persisted workflow
journeys: `tests/e2e/studio-ui.test.ts` (12/12), `tests/e2e/studio-flow.test.ts`
(4/4), `tests/e2e/visual-review-ui.test.ts` (3/3), and the 26/26 smoke checks.
Persisted handoffs observed during this run include:

- `handoff_8c878f993ff04282` → issue `5d8ccb70-3a20-41f2-acad-33a6c789776a`
- `handoff_c1433ebbcd104630` → issue `246974b2-65f3-4521-b654-2389fdfcef5c`
- `handoff_be8b6c37a093422c` → issue `55de512f-77e4-4bae-bbb2-42edd9d4ae95`

Those are genuine persisted Studio fixture workflows and include before/after
review decisions in the existing E2E journeys. They are not counted as the
requested three external-repository agent tasks: this run did not complete the
full installed Studio → OpenCode loop on Godeck, 8t8, and a second unrelated
repository without manual source hints. The prior five OpenCode tasks remain
the standalone-MCP/after-DOM evidence in Phase 36B.

Visual-review evidence from the real Studio suite:

- changed: completed with local-sensitive BEFORE, actual fixture change, AFTER,
  diff, and human decision;
- unchanged: completed and correctly reported;
- incomparable/unavailable: none in the passing review journeys;
- visual evidence genuinely useful: **YES** for the fixture reviews.

Phase 36A feedback was not completed in this closure. Both feedback E2E cases
failed before submission because the diagnostics control was absent. No
feedback artifact is claimed or fabricated. The current checkout contains no
new feedback artifact from this run.

### Corrected metrics and model boundary

The available coding-agent model was exactly `opencode/mimo-v2.5-free`.
No paid/authenticated `mimo-v2.5` provider was exercised.

| Metric | Phase 36C evidence |
|---|---|
| Tasks attempted | 5 prior OpenCode tasks; 0 new external Studio-first tasks completed |
| Full Studio-first tasks completed | 0 external; persisted fixture workflow coverage exists separately |
| Target correct | 5/5 prior OpenCode tasks |
| Source hint useful | Godeck PARTLY; 8t8 NO; unavailable candidates N/A |
| Context/handoff useful | 5/5 PARTLY in prior OpenCode evidence |
| Top source candidate == actual edited source | 0/2 prior candidate-bearing tasks |
| Actual source anywhere in bounded candidates | not proven for Godeck/8t8 |
| Manual context after handoff | 0 recorded |
| Correct code edited | 5/5 prior OpenCode tasks |
| First-attempt success | 4/5; Godeck required an edit retry |
| Agent self-recovery | 1/5 (Godeck retry, no human clarification) |
| Human clarification required | 0 recorded |
| Pixel visual reviews completed | fixture suite: 2 changed/unchanged journeys; external tasks: 0 |
| Verification useful | YES for fixture visual evidence; YES for prior DOM evidence |
| Feedback artifacts created | 0 |
| Setup failures | default test environment setup assumptions: 2 CI failures; clean HOME missing browser/cache state |
| Blocking Viskod failures | feedback control missing in both feedback E2E journeys; external Studio-first loop not closed |

### Phase 36C decision

**B. TARGETED HARDENING.** Evidence-backed defects only:

1. Godeck’s intended `src/app/(marketing)/page.tsx` is discovered, but weak
   text-only candidates still outrank it in the real bounded result.
2. 8t8 reproduces the prior false `app/agent/[id]/page.tsx` top candidate.
3. Phase 36A feedback journeys cannot reach submission because the diagnostics
   control is absent from the rendered flow.
4. The release gate is not green in the current environment.

The evidence does not support release-candidate preparation: the external
three-task Studio-first OpenCode loop and feedback artifact path remain
unproven. No Phase 37 work is started.
 
### Phase 36C follow-up verification

The two previously observed CI setup failures were reproduced and corrected
without touching the developer's real configuration:

- `packages/setup/src/setup.test.ts` now passes an isolated `cwd` and `home`
  to agent-config readiness checks.
- `packages/setup/src/doctor.test.ts` runs its no-project-root case with an
  isolated temporary working directory, so checkout `.viskod` state cannot
  satisfy the assertion.

Focused setup/doctor verification passed **63/63 tests**. The full
`pnpm test:ci` subsequently passed **73 files / 1,095 tests**.

The Phase 36A feedback regression was also reproduced. The rendered feedback
panel referenced `#feedback-diagnostics` in its submit and preview handlers but
did not render the opt-in control. The panel now renders an explicit
`Include sanitized diagnostics (optional)` checkbox. The full feedback E2E
file passed **3/3 tests**, including idle feedback, post-review usefulness,
deduplication, and privacy assertions. Feedback artifacts remained local and
sanitized; no source, DOM secrets, screenshots, raw packets, paths, or
credentials were present.

This follow-up closes the prior CI and feedback regressions. It does not
retroactively convert the unavailable external Studio/OpenCode sample into
positive evidence: the external-task and external-pixel-review requirements
remain unproven, and the final Phase 36C decision remains targeted hardening.
 
### Final post-fix validation

After the hermetic setup changes, feedback checkbox restoration, and MCP
timeout-evidence stabilization:

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS — 331 files |
| `pnpm test:ci` | PASS — 73 files, 1,095 tests |
| `pnpm test:e2e` | PASS — 15 files, 90 tests |
| `pnpm test:dogfood` | PASS — 7 files, 129 tests |
| `pnpm smoke:agent-workflow` | PASS — 26/26 checks |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | PASS — packed artifact verified |
| `pnpm release:check` | PASS — complete chained gate |

The green gate is current and includes Phase 30/33 source-resolution,
Phase 31 visual-review/privacy, Phase 32 setup/ownership, Phase 34 restart,
and Phase 36A feedback coverage. The remaining beta limitation is evidence
scope, not a failing regression gate: three external Studio-first
OpenCode-backed tasks across two unrelated repositories were not directly
completed in this run.
 
### External Studio-first beta journeys

The previously unproven external loop was completed on two unrelated
repositories using the real Studio browser/runtime, persisted issue/handoff
records, OpenCode, and Studio visual review:

| Task | Repository / target | Handoff | Edited file | Source result | Review |
|---|---|---|---|---|---|
| E1 | Godeck `/` hero `h1` | `handoff_c095b026427e4a9e` | `src/app/(marketing)/page.tsx` | Top candidate `src/app/(app)/analytics/page.tsx`, weak/text-only, 0.34; actual file was not top-ranked | changed, accepted, pixel diff 0.2179 |
| E2 | 8t8 `/` hero `h1` | `handoff_a03bea4085b149ae` | `app/page.tsx` | Context/handoff led OpenCode to the homepage route; no proactive path hint | changed, accepted, pixel diff 0.1785 |
| E3 | 8t8 `/` search input | `handoff_b6f5152ad0bf4d03` | `components/home-search.tsx` | Persisted handoff source hints unavailable; prior bounded probe top was unrelated `app/agent/[id]/page.tsx`; agent independently verified and edited `home-search.tsx` | changed, accepted, pixel diff 0.0439 |

Issue/review linkage:

- E1 issue `b3bddefe-6893-48e2-bad0-623bd14c8ddd`, review
  `review_c46dba4af7064cd7`.
- E2 issue `7a3b298d-6db9-424b-979c-9a235f0dff8f`, review
  `review_b7256683b3b9463a`.
- E3 issue `106378f0-5c42-4784-9015-a42d66ab7f9d`, review
  `review_41ec80300f8d4b3b`.

All three agents used `opencode/mimo-v2.5-free`. The prompts supplied only
the normal persisted handoff ID; no proactive source-file hint was supplied.
OpenCode fetched the handoff through the installed Viskod MCP configuration.
E1 was explicitly resumed through a fresh Studio process before recapture,
decision, and feedback, proving restart/reopen durability outside fixtures.

All three reviews used the
`local-sensitive-target-crop` policy and produced BEFORE, AFTER, and DIFF
artifacts with compatible dimensions and human `accepted` decisions:

- E1: `changed`, `changedPixelRatio=0.2179`, geometry y delta `-12`.
- E2: `changed`, `changedPixelRatio=0.1785`, target height delta `14.38`.
- E3: `changed`, `changedPixelRatio=0.0439`, target x delta `-8`, width delta
  `8`.

The real feedback artifacts were local and linked to their review records:

- E1 feedback `81891d19-761c-40bd-ae35-d7930b3cc45e`.
- E2 feedback `0e31da83-0729-4321-91ab-11703d0efcdd`.
- E3 feedback `4f4af22d-b1e6-47f1-81ac-5b28219d2472`.

Each answered **YES** to “Did Viskod give the agent enough context?” with
diagnostics explicitly opted in. Persisted diagnostics contained only the
allowlisted runtime/workflow fields; no source code, DOM secrets, screenshots,
packets, paths, credentials, or agent conversation.

### Final Phase 36C scorecard

| Metric | Result |
|---|---|
| External Studio-first tasks attempted | 3 |
| External Studio-first tasks completed | 3 |
| Repositories | 2 unrelated repositories: Godeck and 8t8 |
| Target correct | 3/3 |
| Source hint useful | E1 PARTLY; E2 N/A; E3 NO |
| Context/handoff useful | 3/3 YES |
| Top candidate == edited source | 0/2 tasks with a ranked candidate |
| Edited source anywhere in bounded candidates | E1 NO; E3 NO from the prior bounded list; E2 N/A |
| Manual post-handoff context | 0 |
| Correct code edited | 3/3 |
| First-attempt success | 3/3 |
| Agent self-recovery | 0 |
| Human clarification required | 0 |
| Pixel visual reviews completed | 3/3 |
| Visual verification useful | 3/3 YES |
| Feedback artifacts created | 3 |
| Restart/reopen success | 1/1 attempted (E1) |
| Setup failures | 0 in final green matrix |
| Blocking Viskod failures | 0 for the completed external workflows |

The source and context metrics remain separate. DOM/style usefulness is not
being used to inflate source usefulness. The source-ranking weakness is
truthfully bounded: Godeck still exposes the unrelated weak analytics
candidate, while 8t8 search still lacks a persisted source candidate despite
the agent finding the correct component through repository verification.

### Final decision

**B. TARGETED HARDENING.** The release gate and full external workflow now pass,
but source guidance remains only partly useful or unavailable on the measured
real targets. No confidence threshold was raised, no ownership was fabricated,
and Phase 37 was not started.
