# RPP-0530 session user identity release-summary proof

Date: 2026-05-30

## Scope

RPP-0530 proves the existing executor-auth session user identity binding at the
`verify:release` release-summary boundary. This slice is intentionally limited
to release-summary proof and does not change route registration, credential
handling, nonce storage, idempotency behavior, or recovery/journal internals.

## Proof behavior

- The combined release topology evidence carries exactly one
  `authSessionUserIdentity` block built by
  `buildReleaseAuthSessionUserIdentityEvidence()`.
- That block now requires hash-only route evidence from both issuance and
  readback before reporting `ok: true`: `issued.sessionHash`,
  `issued.userIdentityHash`, `readback.sessionHash`, and
  `readback.userIdentityHash`.
- The summary still includes continuity booleans (`sameSession`,
  `sameUserLogin`, `sameUserId`, and `manageOptions`) for operator context, but
  those booleans no longer infer success when route hash evidence is absent.
- The focused proof verifies the positive path stays hash-only and rejects both
  missing identity-hash evidence and spoofed `ok: true` claims without route
  hashes.

## Validation observed

```sh
node --check scripts/playground/production-shaped-live-release-verify.mjs
node --check test/rpp-0530-session-user-identity-release-summary.test.js
node --test test/rpp-0530-session-user-identity-release-summary.test.js
node --check test/rpp-0510-session-user-identity-binding.test.js
php -l scripts/playground/push-remote-rest-plugin.php
node --test test/rpp-0530-session-user-identity-release-summary.test.js test/rpp-0510-session-user-identity-binding.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js test/production-preflight-route.test.js
node --test --test-name-pattern='auth/session boundary proof reports same-source readback and capability continuity|auth/session boundary proof rejects readback source drift|production auth/session lifecycle trace summary keeps auth identity user id on the release-boundary read' test/production-shaped-proof.test.js
node --test test/release-verifier-release-movement-summary-carry-through-focused-regression.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0530-session-user-identity-release-summary.md docs/reprint-push-completion-checklist.md
```

Observed result: each command exited 0. The focused RPP-0530 test reported 4
subtests ok, and the adjacent auth/session route-summary bundle reported 17
subtests ok.

## Residual risks

- This proof evaluates the release-summary boundary with production-shaped
  verifier helpers and source-level inclusion checks; it is not a new external
  live production host run.
- The summary still relies on upstream route/session code to produce the
  hash-only `userIdentityHash` evidence already covered by RPP-0510.
