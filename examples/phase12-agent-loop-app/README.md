# Phase 12B Agent Loop Fixture

Controlled UI bug dogfood fixture for Viskod Context Packet validation.

## Bugs

| # | Issue | File | Selector |
|---|---|---|---|
| 1 | Card has no visible border — blends into page background | `styles.css` | `.phase12-target-card` |
| 2 | Button is full-width instead of centered inline | `styles.css` | `#phase12-submit-button` |
| 3 | Description text `#999` on white background fails WCAG contrast | `styles.css:54` | `.card-description` |
| 4 | Card padding uneven (too tight on sides, loose on top) | `styles.css:40` | `.phase12-target-card` |
| 5 | Form gap too tight between label/input/button | `styles.css:57-69` | `.card-form` |
| 6 | Console error with fake API key (tests redaction) | `app.js:28` | — |
| 7 | Failed fetch to `/api/phase12/submit` (tests network evidence) | `app.js:16-20` | — |

## Running

```bash
# Terminal 1 — serve the fixture
node examples/phase12-agent-loop-app/server.cjs

# Terminal 2 — start Viskod session
pnpm viskod start http://localhost:3000

# Terminal 3 — capture profiles
pnpm viskod capture ".phase12-target-card" --profile default
pnpm viskod capture ".phase12-target-card" --profile debug
pnpm viskod capture ".phase12-target-card" --profile audit
pnpm viskod capture "#phase12-submit-button" --profile debug

# Check status
pnpm viskod status

# Stop
pnpm viskod stop
```

## Expected Evidence

| Profile | Screenshot | Console | Network | Source Hints |
|---|---|---|---|---|
| default | ✅ | ❌ | ❌ | ✅ |
| debug | ✅ | ✅ (VISKOD_SMOKE_ERROR) | ✅ (/api/phase12/submit) | ✅ |
| audit | ❌ | ✅ (500 entries) | ✅ (200 entries) | ❌ |

Sensitive values (`sk_test_phase12_abc123`) must be redacted in all profiles.
