# Phase 12A Redaction Fix Report

**Date:** 2026-07-28

---

## Blockers Fixed

| # | Blocker | Root Cause | Fix |
|---|---|---|---|
| 1 | `sk_test_123456` leaked in console evidence | API key pattern required 20+ chars (`sk-` prefix). `sk_test_` prefix not covered. | Added patterns for `sk_test_*`, `sk_live_*`, `pk_test_*`, `pk_live_*` with 3+ char suffix. Added `api-key-assignment` rule. |
| 2 | `secret-token-123` leaked in network URL query param | No rule for URL query parameter values by parameter name. | Added `query-param-sensitive` rule that redacts `?token=`, `?api_key=`, `?secret=`, `?password=`, `?session=`, `?csrf=`, `?auth=`, etc. |
| 3 | Redaction not applied to all fields | `console.stack` and `network.statusText` were not redacted. | Added `stack` field to `ConsoleEntry`. Added recursive redaction for `console.stack`, `network.statusText`. |
| 4 | Duplicate capture directories (2 per CLI invocation) | Event subscriber re-triggered `generatePacket` via `SE_EVENT:SELECTION_CHANGED` from `validateSelection()` inside the first `generatePacket` call. | Added `isGeneratingPacket` re-entrancy guard. Event subscriber now skips when `isGeneratingPacket` is true. |
| 5 | Daemon token leaked in CLI status output | `cmdStatus` printed raw `SessionInfo` including token. | `status` output now replaces `token` with `'[REDACTED]'`. |

---

## Redaction Rules Added/Enhanced

| Rule | Pattern | Label | Example |
|---|---|---|---|
| Query param sensitive | `?(token\|access_token\|...)=[^&\s]{4,}` | `query-param-sensitive` | `?token=secret123` → `?token=[REDACTED]` |
| API key (`sk_`/`pk_`) | `(sk[-_](test\|live)_[A-Za-z0-9]{3,}\|...)` | `api-key` | `sk_test_123456` → `[API_KEY_REDACTED]` |
| API key assignment | `api[_-]?key['"]?\s*[:=]\s*['"]?...` | `api-key-assignment` | `api_key = sk-proj-abc...` → `[API_KEY_REDACTED]` |
| Inline secret | `(token\|secret\|password\|...)\s+...{6,}` | `inline-secret` | `secret mypass123` → `[SECRET_REDACTED]` |
| Assign secret (non-URL) | `(token\|secret\|password)=...` | `assign-secret` | `password=abc123` → `[SECRET_REDACTED]` |
| Base64 token | `[A-Za-z0-9+/]{16,}(==\|=\|)` | `base64-token` | `abc...xyz==` → `[TOKEN_REDACTED]` |

All existing rules (email, card, base64) preserved.

---

## Files Changed

| File | Change |
|---|---|
| `packages/browser-runtime/src/evidence.ts` | Added `stack` to `ConsoleEntry`. Enhanced `DEFAULT_RULES` with 3 new rule types and query-param redaction. `RedactionRule.replacement` accepts `string \| function`. Recursive redaction for `console.stack` and `network.statusText`. |
| `packages/context-engine/src/index.ts` | Added `isGeneratingPacket` re-entrancy guard to prevent duplicate capture directories. |
| `packages/cli/src/index.ts` | `cmdStatus` redacts token as `'[REDACTED]'`. |
| `packages/browser-runtime/src/evidence.test.ts` | Updated label expectations. Added 8 new tests for new rules. |

---

## Tests Added/Updated

| Test | What it verifies |
|---|---|
| `redacts sk_test_123456 in console messages` | API key pattern matches `sk_test_` prefix |
| `redacts sk_live_ prefixed keys` | `sk_live_` prefix also matched |
| `redacts api key assignment pattern` | `api key 'sk_test_abc...'` → `[API_KEY_REDACTED]` |
| `redacts token= in URL query parameters` | `?token=secret-token-123` → `?token=[REDACTED]` |
| `redacts sensitive query parameters by name` | `?access_token=`, `?api_key=`, `?session=`, `?csrf=`, `?password=` |
| `redacts console.stack recursively` | Stack trace values also redacted |
| `redacts network statusText recursively` | `statusText` values also redacted |
| `full redaction of mixed evidence` | All fields redacted end-to-end |

**Total: 183 tests** (up from 175; 8 new)

---

## Validation

| Check | Result |
|---|---|
| `pnpm check` (biome + tsc + vitest) | ✅ Pass |
| `biome check .` | ✅ 0 errors across 101 files |
| `tsc -b` (TypeScript strict) | ✅ 0 errors |
| `vitest run` | ✅ **183 tests**, 0 failed (17 test files) |

---

## Documentation/Specs

- `/docs` — not modified
- `/specs` — not modified
