# Release Checklist — v0.2.0-alpha

## Prerequisites

- [ ] Node.js >= 22.0.0 installed
- [ ] pnpm >= 9.0.0 installed
- [ ] Playwright Chromium browser installed (`pnpm exec playwright install chromium`)
- [ ] Clean working tree (`git status --short` shows no unexpected changes)
- [ ] No untracked generated artifacts (`.viskod/captures/`, `.opencode/`)

## Validation Commands

Run each command and confirm exit code 0:

```bash
# Full quality gate (Biome + TypeScript + unit tests + MCP smoke)
pnpm release:check

# Individual gates (alternative to release:check)
pnpm check:biome       # Biome lint + format
pnpm check:types       # TypeScript compilation
pnpm check:test        # Unit tests (vitest)
pnpm smoke:agent-workflow  # MCP E2E smoke test
```

## MCP Smoke Check

- [ ] Fixture server running on `http://127.0.0.1:3000`
- [ ] `pnpm smoke:agent-workflow` exits 0
- [ ] `tools/list` returns `capture_context` and `recapture_context`
- [ ] `capture_context` returns `packetPath`, `captureDir`, `brief`
- [ ] `recapture_context` returns `comparisonSummary` with `boundingBoxDelta`, `areaDelta`, `verdict`

## Privacy / Token Checks

- [ ] No `daemon-token`, `sessionToken`, or `sk_test` in any committed file
- [ ] No private absolute paths (e.g., `C:\Users\...`) in committed docs or configs
- [ ] No `secret-token`, `test@example.com` or similar test secrets
- [ ] Redaction defaults are enabled (profile `enableRedaction` is not `false`)
- [ ] `.viskod/captures/`, `.viskod/session.json`, `.opencode/` are in `.gitignore`

## Artifact Cleanup

- [ ] No `.viskod/` files tracked in git
- [ ] No `.opencode/` files tracked in git
- [ ] No `packet.json`, `metadata.json`, or `selection.png` tracked
- [ ] No `.tmp` files tracked
- [ ] `graphify-out/2026-*/` directories are gitignored

## Tag Command

```bash
# After all checks pass on the target commit:
git tag -a v0.2.0-alpha -m "v0.2.0-alpha — MCP agent workflow validated"
git push origin v0.2.0-alpha
```

## Rollback Notes

If the release reveals an issue:

1. Remove the tag: `git tag -d v0.2.0-alpha && git push origin :refs/tags/v0.2.0-alpha`
2. Fix the issue on a branch.
3. Re-run the full checklist.
4. Re-tag.

The `pnpm release:check` script must pass before any tag is applied.
The MCP smoke test is the most sensitive indicator — if it fails, do not tag.

## Known Alpha Limitations

- The MCP server uses stdin/stdout only. SSE/WebSocket transport is not implemented.
- Element selection requires a valid CSS selector. Shadow DOM and dynamic class names may complicate this.
- Source hints are best-effort. The engine may not find exact source file matches for all elements.
- Screenshots capture the current viewport state. Animations or transitions may not be fully rendered.
- Network evidence is collected from the page context only, not from workers or extensions.
- The smoke script depends on `npx.cmd` on Windows (or `npx` on POSIX) finding the `tsx` loader.
- Playwright Chromium browser must be installed separately via `pnpm exec playwright install chromium`.
- Root `package.json` is marked `"private": true` to prevent accidental npm publish.
