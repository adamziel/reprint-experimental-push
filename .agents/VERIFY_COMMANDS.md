# Verify Commands

Canonical release command:

```bash
timeout 300s npm run verify:release
```

Expected before live source exists:

- `npm test`: pass on the integration branch before merge.
- `timeout 300s npm run verify:release`: fail closed with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED` or equivalent.
- Release gates: still `0/4`.

Observed topology-verifier proof, 2026-05-27:

```bash
timeout 300s npm run verify:release
```

Result: failed closed with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`; release movement allowed: no; gates remain `0/4`. The emitted topology JSON reported runner `scripts/playground/production-shaped-live-release-verify.mjs`, sandbox ingress `8080`, no accepted source/local/changed service ports, `packagedFallbackAllowed: false`, and `packagedFallbackSource: false`.

Focused inspection commands:

```bash
git diff --stat origin/main..origin/lane/reliable-executor
git diff --name-only origin/main..origin/lane/reliable-executor
git show origin/lane/reliable-executor:package.json | sed -n '1,140p'
git show origin/lane/reliable-executor:scripts/playground/production-shaped-release-verify.mjs | sed -n '1,220p'
```
