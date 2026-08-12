## Summary

Describe the change and the user problem it solves.

## User-visible behavior

What should users observe after this change?

## Verification

Commands run and relevant results:

- [ ] `pnpm check`
- [ ] `pnpm smoke:agent-workflow` (when the workflow or runtime is affected)
- [ ] Other: `...`

## Security and privacy impact

- Does this change affect redaction, path safety, tokens, cookies, selectors, screenshots, localhost binding, or persisted output?
- If yes, explain the boundary and tests.

## Documentation impact

- [ ] README/docs updated or no documentation change is needed.

## Checklist

- [ ] Tests cover the observable behavior and relevant failure paths.
- [ ] No secrets, raw packet JSON, absolute paths, or session tokens are exposed.
- [ ] Public package/API behavior remains alpha-compatible, or the breaking change is explicit.
- [ ] The human review boundary remains intact.
