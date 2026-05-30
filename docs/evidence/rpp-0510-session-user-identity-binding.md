# RPP-0510 session user identity binding evidence

RPP-0510 adds focused executor-auth coverage for session user identity binding and the release-verifier summary carry-through.

## Scope

- Short-lived push sessions now store hash-only user identity binding material (`userIdentityHash`) plus the authenticated WordPress `userId`/`userLogin` needed for fail-closed comparisons.
- Signed dry-run/apply/recovery/journal requests must present a session whose stored user identity hash, user ID, and user login still match the authenticated request before canonical route verification proceeds.
- Preflight and signed-request evidence now expose `userIdentityHash` with the existing session hash/source hash evidence; dry-run receipt issue bindings carry the same hash-only user identity evidence.
- `verify:release` combined topology evidence now includes one `authSessionUserIdentity` summary block with session/user identity continuity and hashed issuance/readback evidence.

## Boundary notes

- This slice intentionally avoids Application Password integration changes, receipt-expiry policy changes, and idempotency replay behavior.
- The added release-verifier summary avoids credential material and carries only session/user identity hashes plus boolean continuity fields.

## Focused validation

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --check scripts/playground/production-shaped-release-verify.mjs` — exit 0.
- `node --check scripts/playground/production-shaped-live-release-verify.mjs` — exit 0.
- `node --check test/rpp-0510-session-user-identity-binding.test.js` — exit 0.
- `node --test test/rpp-0510-session-user-identity-binding.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js test/production-preflight-route.test.js` — exit 0.
- `node --test --test-name-pattern='auth/session boundary proof reports same-source readback and capability continuity|auth/session boundary proof rejects readback source drift' test/production-shaped-proof.test.js` — exit 0.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0510-session-user-identity-binding.md docs/reprint-push-completion-checklist.md` — exit 0.
- `git diff --check` — exit 0.

## Residual risks

- Coverage is source-level focused route/session validation, not a new live WordPress endpoint smoke run.
- The production-shaped route still uses the mounted Playground implementation when lab routes are enabled; package-mode production hardening remains outside this slice.
